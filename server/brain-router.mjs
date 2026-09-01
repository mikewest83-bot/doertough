const OPENAI_MODELS = {
  mini: process.env.MIKE_MINI_MODEL || 'gpt-4o-mini',
  terra: 'gpt-5.6-terra',
  sol: 'gpt-5.6-sol',
};
const CLAUDE_MODEL = 'claude-opus-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const VALID_REASONING = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const BRAIN_ORDER = ['mini', 'terra', 'sol', 'opus'];

// Only the gpt-5.6 tier accepts a `reasoning` parameter. Sending one to the
// mini model is a request error, so the floor brain must be called without it.
const REASONING_BRAINS = new Set(['terra', 'sol']);

const normalizeBrain = (value) => {
  const brain = String(value || '').trim().toLowerCase();
  return [...BRAIN_ORDER, 'auto'].includes(brain) ? brain : 'auto';
};

const reasoningEffort = () => {
  const requested = String(process.env.MIKE_REASONING_EFFORT || 'medium').trim().toLowerCase();
  return VALID_REASONING.has(requested) ? requested : 'medium';
};

// Escalation thresholds, tunable without a code change so they can be moved
// from real traffic rather than guesswork. Every routing decision logs its
// score, so the distribution is visible in the deploy log.
const threshold = (name, fallback) => {
  const raw = Number(process.env[`MIKE_ESCALATE_${name}`]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
const thresholds = () => ({
  terra: threshold('TERRA', 4),
  sol: threshold('SOL', 8),
  opus: threshold('OPUS', 12),
});

// The user wants reasoning, not a lookup. "What's this truck worth" is a tool
// call and belongs on the floor brain; "why is it worth less than that one"
// is not.
const REASONING_SIGNALS = [
  'why', 'explain', 'compare', 'difference between', 'pros and cons', 'trade-off', 'tradeoff',
  'should i', 'walk me through', 'figure out', 'strategy', 'negotiate', 'root cause',
  'debug', 'analyze', 'worth it', 'best way', 'how do i', 'help me decide',
];

// Whole pieces of work rather than questions.
const DEEP_SIGNALS = [
  'business plan', 'financial model', 'contract', 'architecture', 'step by step',
  'deep dive', 'write the code', 'refactor', 'audit', 'lawsuit', 'taxes',
];

// The user is telling us the previous answer was not good enough. This is the
// strongest real-world escalation cue there is — a person pushing back has
// already decided the cheap answer missed.
const PUSHBACK_SIGNALS = [
  "that's wrong", 'thats wrong', 'that is wrong', 'not right', 'you missed',
  "you're missing", 'youre missing', 'try again', 'think harder', 'think about it',
  'no, actually', 'that makes no sense',
];

const countHits = (text, signals) => signals.reduce((n, s) => (text.includes(s) ? n + 1 : n), 0);

/**
 * How much thinking this message plausibly needs. Tuned for speech: people
 * talk in short sentences, so length counts for little and intent counts for
 * a lot. The old scoring needed a ~2,700-character message hitting five
 * keywords before it left the floor, which never happens out loud.
 */
export function complexityScore(message = '') {
  const text = String(message).toLowerCase();
  const length = Math.min(2, Math.floor(text.length / 350));
  const reasoning = Math.min(3, countHits(text, REASONING_SIGNALS)) * 2;
  const deep = Math.min(3, countHits(text, DEEP_SIGNALS)) * 3;
  // Worth a full tier on its own: if someone says the last answer was wrong,
  // handing them the same floor brain again is how you lose them.
  const pushback = countHits(text, PUSHBACK_SIGNALS) > 0 ? 4 : 0;
  const multiPart = (text.match(/\?/g) || []).length >= 2 ? 1 : 0;
  return length + reasoning + deep + pushback + multiPart;
}

const opusReady = () => Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());

/** Opus without a key degrades to sol rather than throwing chat away. */
const availableBrain = (desired) => (desired === 'opus' && !opusReady() ? 'sol' : desired);

/** The brain this message asks for, before availability is considered. */
export function pickBrain(message = '') {
  const score = complexityScore(message);
  const limit = thresholds();
  if (score >= limit.opus) return { brain: 'opus', score };
  if (score >= limit.sol) return { brain: 'sol', score };
  if (score >= limit.terra) return { brain: 'terra', score };
  return { brain: 'mini', score };
}

export function resolveBrain({ message = '', requested = process.env.MIKE_BRAIN || 'auto' } = {}) {
  const mode = normalizeBrain(requested);
  if (mode !== 'auto') return availableBrain(mode);
  return availableBrain(pickBrain(message).brain);
}

export function getBrainStatus() {
  const configuredMode = normalizeBrain(process.env.MIKE_BRAIN || 'auto');
  return {
    configuredMode,
    reasoningEffort: reasoningEffort(),
    defaultBrain: 'mini',
    escalation: thresholds(),
    available: {
      mini: Boolean(process.env.OPENAI_API_KEY),
      terra: Boolean(process.env.OPENAI_API_KEY),
      sol: Boolean(process.env.OPENAI_API_KEY),
      opus: opusReady(),
    },
    models: { mini: OPENAI_MODELS.mini, terra: OPENAI_MODELS.terra, sol: OPENAI_MODELS.sol, opus: CLAUDE_MODEL },
  };
}

function toAnthropicTools(tools = []) {
  return tools
    .filter((tool) => tool?.type === 'function' && tool.name)
    .map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.parameters || { type: 'object', properties: {} },
    }));
}

function textFromContent(content) {
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text')
      .map((block) => String(block.text || ''))
      .join('')
      .trim();
  }
  return typeof content === 'string' ? content : '';
}

function openAiInputToAnthropic(input = []) {
  const messages = [];
  for (const item of input) {
    if (!item) continue;
    if (item.role === 'user') {
      const text = textFromContent(item.content);
      if (text) messages.push({ role: 'user', content: text });
      continue;
    }
    if (item.role === 'assistant') {
      const text = textFromContent(item.content);
      if (text) messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
      continue;
    }
    if (item.type === 'function_call') {
      let inputObject = {};
      try { inputObject = item.arguments ? JSON.parse(item.arguments) : {}; } catch {}
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        if (!Array.isArray(last.content)) last.content = [{ type: 'text', text: String(last.content || '') }];
        last.content.push({ type: 'tool_use', id: item.call_id, name: item.name, input: inputObject });
      } else {
        messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: item.call_id, name: item.name, input: inputObject }] });
      }
      continue;
    }
    if (item.type === 'function_call_output') {
      const last = messages[messages.length - 1];
      const result = { type: 'tool_result', tool_use_id: item.call_id, content: String(item.output ?? '') };
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((block) => block?.type === 'tool_result')) {
        last.content.push(result);
      } else {
        messages.push({ role: 'user', content: [result] });
      }
    }
  }
  return messages;
}

async function callOpenAI({ brain, instructions, input, tools, client }) {
  if (!client) {
    const error = new Error('OPENAI_API_KEY_not_configured');
    error.status = 503;
    throw error;
  }
  const request = { model: OPENAI_MODELS[brain], instructions, input, tools };
  if (REASONING_BRAINS.has(brain)) request.reasoning = { effort: reasoningEffort() };
  return client.responses.create(request);
}

async function callClaude({ instructions, input, tools }) {
  const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) {
    const error = new Error('ANTHROPIC_API_KEY_not_configured');
    error.status = 503;
    throw error;
  }
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: Number(process.env.MIKE_OPUS_MAX_TOKENS || 8192),
      system: instructions,
      messages: openAiInputToAnthropic(input),
      tools: toAnthropicTools(tools),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `anthropic_http_${response.status}`);
    error.status = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  const output = [];
  let outputText = '';
  for (const block of payload.content || []) {
    if (block.type === 'text') {
      outputText += block.text || '';
    } else if (block.type === 'tool_use') {
      output.push({
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input || {}),
      });
    }
  }
  return { output, output_text: outputText.trim(), usage: payload.usage, _brain: 'opus' };
}

export async function generateBrainResponse({ client, instructions, input, tools, message = '' } = {}) {
  const mode = normalizeBrain(process.env.MIKE_BRAIN || 'auto');
  const { brain: wanted, score } = mode === 'auto' ? pickBrain(message) : { brain: mode, score: null };
  const selected = availableBrain(wanted);
  if (selected !== wanted) {
    console.warn(`[brain] ${wanted} unavailable (no ANTHROPIC_API_KEY) - using ${selected}`);
  }
  const started = Date.now();
  const response = selected === 'opus'
    ? await callClaude({ instructions, input, tools })
    : await callOpenAI({ brain: selected, instructions, input, tools, client });
  const model = selected === 'opus' ? CLAUDE_MODEL : OPENAI_MODELS[selected];
  // score is logged so the thresholds can be tuned from real traffic.
  console.log(`[brain] ${selected} (${model}) score=${score ?? 'forced'} in ${Date.now() - started}ms`);
  return response;
}

export const BRAIN_MODELS = { ...OPENAI_MODELS, opus: CLAUDE_MODEL };
