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

// Effort per tier, not one global setting. Terra is the FIRST escalation and
// catches merely-mild questions, so it runs lean; sol was reached because the
// question is genuinely hard, so it keeps thinking. A single global value made
// the common case slow (27.8s measured on terra) to protect the rare case.
const TIER_EFFORT_DEFAULT = { terra: 'low', sol: 'medium' };

const validEffort = (value, fallback) => {
  const v = String(value || '').trim().toLowerCase();
  return VALID_REASONING.has(v) ? v : fallback;
};

const reasoningEffort = (brain) => {
  const perTier = process.env[`MIKE_REASONING_EFFORT_${String(brain || '').toUpperCase()}`];
  if (perTier) return validEffort(perTier, TIER_EFFORT_DEFAULT[brain] || 'medium');
  // A global MIKE_REASONING_EFFORT still overrides every tier, so one variable
  // can turn the whole thing up when it matters.
  if (process.env.MIKE_REASONING_EFFORT) {
    return validEffort(process.env.MIKE_REASONING_EFFORT, TIER_EFFORT_DEFAULT[brain] || 'medium');
  }
  return TIER_EFFORT_DEFAULT[brain] || 'medium';
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

// Keyword scoring guesses at difficulty from the words used. That misreads
// speech badly: "should I lease or finance a skid steer" is a genuinely hard
// question carried by eight plain words, and scores almost nothing. So the
// floor brain also gets a way to raise its own hand. Mike judges the question
// it can actually see, which is what keyword matching can only approximate.
const ESCALATION_TOOL_NAME = 'escalate_to_deep_reasoning';
const escalationEnabled = () => String(process.env.MIKE_ESCALATION_TOOL || '1').trim() !== '0';
const LEVEL_TO_BRAIN = { deep: 'sol', deepest: 'opus' };

const ESCALATION_TOOL = {
  type: 'function',
  name: ESCALATION_TOOL_NAME,
  description: [
    'Hand this question to a stronger model instead of answering it yourself.',
    'Call this ONLY when answering well needs sustained reasoning you cannot do here:',
    'several constraints that interact, a long document to weigh, a costly decision',
    'where the obvious answer is probably wrong, or a plan whose steps depend on each other.',
    'Do NOT call it for a lookup, a definition, a price check, arithmetic, or anything',
    'another tool already answers. A short question can still be a hard one - judge the',
    'problem, not the number of words. If you call this, do not also answer: the stronger',
    'model receives the whole conversation and takes it from there.',
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      level: {
        type: 'string',
        enum: ['deep', 'deepest'],
        description: "'deep' for a hard multi-step question. 'deepest' when several constraints interact and being wrong is expensive.",
      },
      reason: { type: 'string', description: 'One short sentence naming what makes this too hard to answer directly.' },
    },
    required: ['level', 'reason'],
    additionalProperties: false,
  },
};

const rank = (brain) => BRAIN_ORDER.indexOf(brain);

/** Highest tier that can actually answer right now. */
const topAvailable = () => (opusReady() ? 'opus' : 'sol');

/** Did the model ask to be relieved? Returns the request, or null. */
function findEscalation(response) {
  for (const item of response?.output || []) {
    if (item?.type === 'function_call' && item.name === ESCALATION_TOOL_NAME) {
      let args = {};
      try { args = item.arguments ? JSON.parse(item.arguments) : {}; } catch {}
      return { level: String(args.level || 'deep'), reason: String(args.reason || 'no reason given') };
    }
  }
  return null;
}

/**
 * The escalation tool is ours, not the app's. index.mjs has no handler for it,
 * so it must never survive into the response we hand back - including the case
 * where a model invents the call without being offered the tool.
 */
function stripEscalationCalls(response) {
  if (!Array.isArray(response?.output)) return response;
  const output = response.output.filter((item) => !(item?.type === 'function_call' && item.name === ESCALATION_TOOL_NAME));
  return output.length === response.output.length ? response : { ...response, output };
}

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
  let brain = 'mini';
  if (score >= limit.opus) brain = 'opus';
  else if (score >= limit.sol) brain = 'sol';
  else if (score >= limit.terra) brain = 'terra';

  // Someone saying the last answer was wrong has already proved the cheaper
  // tier failed them. Sending that back to a lean-effort tier risks repeating
  // the same miss, so pushback sets a floor rather than just adding points.
  if (countHits(String(message).toLowerCase(), PUSHBACK_SIGNALS) > 0 && rank(brain) < rank('sol')) {
    return { brain: 'sol', score };
  }
  return { brain, score };
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
    reasoningEffort: { terra: reasoningEffort('terra'), sol: reasoningEffort('sol') },
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

/**
 * Anthropic rejects the whole request with "tools: Tool names must be unique."
 * if two tools share a name; OpenAI accepts it silently. Mike's tool list is
 * assembled from nine separate arrays, so a collision there took opus from
 * "expensive" to "returns 400 every time" while the OpenAI tiers kept working.
 *
 * Deduping here keeps the first definition of each name. That is a guess when
 * the two definitions differ - LIVE_TOOL_HANDLERS is an object literal, so the
 * LAST handler of a duplicated name is the one that actually runs. The warning
 * below names the offender so the real fix can happen in the tool arrays.
 */
function toAnthropicTools(tools = []) {
  const seen = new Set();
  const unique = [];
  const duplicates = new Set();
  for (const tool of tools) {
    if (tool?.type !== 'function' || !tool.name) continue;
    if (seen.has(tool.name)) { duplicates.add(tool.name); continue; }
    seen.add(tool.name);
    unique.push({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.parameters || { type: 'object', properties: {} },
    });
  }
  if (duplicates.size) {
    console.warn(`[brain] duplicate tool name(s) dropped before Anthropic: ${[...duplicates].join(', ')} - fix the source arrays`);
  }
  return unique;
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
  if (REASONING_BRAINS.has(brain)) request.reasoning = { effort: reasoningEffort(brain) };
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

const runBrain = ({ brain, instructions, input, tools, client }) => (brain === 'opus'
  ? callClaude({ instructions, input, tools })
  : callOpenAI({ brain, instructions, input, tools, client }));

const modelName = (brain) => (brain === 'opus' ? CLAUDE_MODEL : OPENAI_MODELS[brain]);

export async function generateBrainResponse({ client, instructions, input, tools, message = '' } = {}) {
  const mode = normalizeBrain(process.env.MIKE_BRAIN || 'auto');
  const { brain: wanted, score } = mode === 'auto' ? pickBrain(message) : { brain: mode, score: null };
  const first = availableBrain(wanted);
  if (first !== wanted) {
    console.warn(`[brain] ${wanted} unavailable (no ANTHROPIC_API_KEY) - using ${first}`);
  }

  // Offer the hand-raise only when there is somewhere better to go, and only
  // when we picked the tier ourselves. A forced MIKE_BRAIN means the operator
  // decided; do not spend a second call overriding them.
  const canEscalate = mode === 'auto' && escalationEnabled() && rank(first) < rank(topAvailable());
  const firstTools = canEscalate ? [...(tools || []), ESCALATION_TOOL] : tools;

  const started = Date.now();
  const firstResponse = await runBrain({ brain: first, instructions, input, tools: firstTools, client });
  console.log(`[brain] ${first} (${modelName(first)}) score=${score ?? 'forced'} in ${Date.now() - started}ms`);

  const ask = canEscalate ? findEscalation(firstResponse) : null;
  if (!ask) return stripEscalationCalls(firstResponse);

  // Never sideways or downward, and never past what is actually available.
  const requested = availableBrain(LEVEL_TO_BRAIN[ask.level] || 'sol');
  const next = rank(requested) > rank(first) ? requested : topAvailable();
  if (rank(next) <= rank(first)) return stripEscalationCalls(firstResponse);

  console.log(`[brain] ${first} -> ${next} (${modelName(next)}) escalated: ${ask.reason}`);
  const escalatedAt = Date.now();
  // The retry deliberately omits ESCALATION_TOOL: one hop per turn, no loops.
  const escalated = await runBrain({ brain: next, instructions, input, tools, client });
  console.log(`[brain] ${next} (${modelName(next)}) answered escalation in ${Date.now() - escalatedAt}ms`);
  return stripEscalationCalls(escalated);
}

export const BRAIN_MODELS = { ...OPENAI_MODELS, opus: CLAUDE_MODEL };
