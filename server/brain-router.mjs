const OPENAI_MODELS = {
  mini: process.env.MIKE_MINI_MODEL || 'gpt-5.6-luna',
  terra: 'gpt-5.6-terra',
  sol: 'gpt-5.6-sol',
};
const CLAUDE_MODEL = 'claude-opus-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const VALID_REASONING = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const BRAIN_ORDER = ['mini', 'terra', 'sol', 'opus'];
const REASONING_BRAINS = new Set(['terra', 'sol']);

const normalizeBrain = (value) => {
  const brain = String(value || '').trim().toLowerCase();
  return [...BRAIN_ORDER, 'auto'].includes(brain) ? brain : 'auto';
};

const TIER_EFFORT_DEFAULT = { terra: 'low', sol: 'medium' };
const validEffort = (value, fallback) => {
  const v = String(value || '').trim().toLowerCase();
  return VALID_REASONING.has(v) ? v : fallback;
};
const reasoningEffort = (brain) => {
  const perTier = process.env[`MIKE_REASONING_EFFORT_${String(brain || '').toUpperCase()}`];
  if (perTier) return validEffort(perTier, TIER_EFFORT_DEFAULT[brain] || 'medium');
  if (process.env.MIKE_REASONING_EFFORT) return validEffort(process.env.MIKE_REASONING_EFFORT, TIER_EFFORT_DEFAULT[brain] || 'medium');
  return TIER_EFFORT_DEFAULT[brain] || 'medium';
};

const threshold = (name, fallback) => {
  const raw = Number(process.env[`MIKE_ESCALATE_${name}`]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
const thresholds = () => ({ terra: threshold('TERRA', 4), sol: threshold('SOL', 8), opus: threshold('OPUS', 12) });

const REASONING_SIGNALS = [
  'why', 'explain', 'compare', 'difference between', 'pros and cons', 'trade-off', 'tradeoff',
  'should i', 'walk me through', 'figure out', 'strategy', 'negotiate', 'root cause',
  'debug', 'analyze', 'worth it', 'best way', 'how do i', 'help me decide',
];
const DEEP_SIGNALS = [
  'business plan', 'financial model', 'contract', 'architecture', 'step by step',
  'deep dive', 'write the code', 'refactor', 'audit', 'lawsuit', 'taxes',
];
const PUSHBACK_SIGNALS = [
  "that's wrong", 'thats wrong', 'that is wrong', 'not right', 'you missed',
  "you're missing", 'youre missing', 'try again', 'think harder', 'think about it',
  'no, actually', 'that makes no sense',
];
const countHits = (text, signals) => signals.reduce((n, s) => (text.includes(s) ? n + 1 : n), 0);

const ESCALATION_TOOL_NAME = 'escalate_to_deep_reasoning';
const escalationEnabled = () => String(process.env.MIKE_ESCALATION_TOOL || '1').trim() !== '0';
// Cost policy: auto mode starts cheap and may escalate only within a score-based ceiling.
// Explicit brain selection remains authoritative; cost policy never overrides a deliberate choice.
const costMode = () => {
  const mode = String(process.env.MIKE_COST_MODE || 'balanced').trim().toLowerCase();
  return ['economy', 'balanced', 'premium'].includes(mode) ? mode : 'balanced';
};
const costCeiling = (score) => {
  const mode = costMode();
  if (mode === 'economy') return 'terra';
  if (mode === 'premium') return 'opus';
  const limit = thresholds();
  if (score >= limit.opus) return 'opus';
  if (score >= limit.sol) return 'sol';
  return 'terra';
};

// One hop at a time: Mini -> Terra -> Sol. Opus is reserved for the deepest work.
const LEVEL_TO_BRAIN = { deep: 'terra', deepest: 'opus' };
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
      level: { type: 'string', enum: ['deep', 'deepest'], description: "'deep' for a hard multi-step question. 'deepest' when several constraints interact and being wrong is expensive." },
      reason: { type: 'string', description: 'One short sentence naming what makes this too hard to answer directly.' },
    },
    required: ['level', 'reason'],
    additionalProperties: false,
  },
};

const rank = (brain) => BRAIN_ORDER.indexOf(brain);
const opusReady = () => Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
const topAvailable = () => (opusReady() ? 'opus' : 'sol');
const availableBrain = (desired) => (desired === 'opus' && !opusReady() ? 'sol' : desired);

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

function stripEscalationCalls(response) {
  if (!Array.isArray(response?.output)) return response;
  const output = response.output.filter((item) => !(item?.type === 'function_call' && item.name === ESCALATION_TOOL_NAME));
  return output.length === response.output.length ? response : { ...response, output };
}

export function complexityScore(message = '') {
  const text = String(message).toLowerCase();
  const length = Math.min(2, Math.floor(text.length / 350));
  const reasoning = Math.min(3, countHits(text, REASONING_SIGNALS)) * 2;
  const deep = Math.min(3, countHits(text, DEEP_SIGNALS)) * 3;
  const pushback = countHits(text, PUSHBACK_SIGNALS) > 0 ? 4 : 0;
  const multiPart = (text.match(/\?/g) || []).length >= 2 ? 1 : 0;
  return length + reasoning + deep + pushback + multiPart;
}

export function pickBrain(message = '') {
  const score = complexityScore(message);
  const limit = thresholds();
  let brain = 'mini';
  if (score >= limit.opus) brain = 'opus';
  else if (score >= limit.sol) brain = 'sol';
  else if (score >= limit.terra) brain = 'terra';
  if (countHits(String(message).toLowerCase(), PUSHBACK_SIGNALS) > 0 && rank(brain) < rank('sol')) return { brain: 'sol', score };
  return { brain, score };
}

export function resolveBrain({ message = '', requested = process.env.MIKE_BRAIN || 'auto' } = {}) {
  const mode = normalizeBrain(requested);
  if (mode !== 'auto') return availableBrain(mode);
  // Auto is deliberately Mini-first. Mini itself owns the decision to escalate.
  return 'mini';
}

export function getBrainStatus() {
  const configuredMode = normalizeBrain(process.env.MIKE_BRAIN || 'auto');
  return {
    configuredMode,
    costMode: costMode(),
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

function toAnthropicTools(tools = []) {
  const seen = new Set();
  const unique = [];
  const duplicates = new Set();
  for (const tool of tools) {
    if (tool?.type !== 'function' || !tool.name) continue;
    if (seen.has(tool.name)) { duplicates.add(tool.name); continue; }
    seen.add(tool.name);
    unique.push({ name: tool.name, description: tool.description || '', input_schema: tool.parameters || { type: 'object', properties: {} } });
  }
  if (duplicates.size) console.warn(`[brain] duplicate tool name(s) dropped before Anthropic: ${[...duplicates].join(', ')} - fix the source arrays`);
  return unique;
}

const TEXT_BLOCK_TYPES = new Set(['text', 'input_text', 'output_text']);
function textFromContent(content) {
  if (Array.isArray(content)) return content.filter((block) => TEXT_BLOCK_TYPES.has(block?.type)).map((block) => String(block.text || '')).join('').trim();
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
      } else messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: item.call_id, name: item.name, input: inputObject }] });
      continue;
    }
    if (item.type === 'function_call_output') {
      const last = messages[messages.length - 1];
      const result = { type: 'tool_result', tool_use_id: item.call_id, content: String(item.output ?? '') };
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((block) => block?.type === 'tool_result')) last.content.push(result);
      else messages.push({ role: 'user', content: [result] });
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
  const messages = openAiInputToAnthropic(input);
  if (!messages.length) {
    const error = new Error('anthropic_empty_conversation');
    error.status = 500;
    throw error;
  }
  // Prompt caching. Anthropic builds its cache prefix tools -> system -> messages, so one
  // breakpoint at the end of `system` covers the tool schemas AND the persona - roughly 10k
  // of the ~11k input tokens, byte-identical on every call. Writes cost 1.25x, reads 0.1x,
  // 5-minute TTL refreshed on each hit, so this only loses if opus fires less than once per
  // window. Guard on a non-empty string: the block form needs real text or the API 400s.
  // Kill switch: MIKE_OPUS_CACHE=0.
  const cacheOn = String(process.env.MIKE_OPUS_CACHE || '1').trim() !== '0' && typeof instructions === 'string' && instructions.trim().length > 0;
  const system = cacheOn ? [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }] : instructions;
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: Number(process.env.MIKE_OPUS_MAX_TOKENS || 8192), system, messages, tools: toAnthropicTools(tools) }),
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
    if (block.type === 'text') outputText += block.text || '';
    else if (block.type === 'tool_use') output.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input || {}) });
  }
  // read close to write means the prefix is being reused; read stuck at 0 means it is changing between calls.
  const u = payload.usage || {};
  if (cacheOn) console.log(`[brain] opus cache write=${u.cache_creation_input_tokens ?? 0} read=${u.cache_read_input_tokens ?? 0} uncached=${u.input_tokens ?? 0}`);
  return { output, output_text: outputText.trim(), usage: payload.usage, _brain: 'opus' };
}

const runBrain = ({ brain, instructions, input, tools, client }) => (brain === 'opus' ? callClaude({ instructions, input, tools }) : callOpenAI({ brain, instructions, input, tools, client }));
const modelName = (brain) => (brain === 'opus' ? CLAUDE_MODEL : OPENAI_MODELS[brain]);

export async function generateBrainResponse({ client, instructions, input, tools, message = '', brain: forced } = {}) {
  const mode = forced ? normalizeBrain(forced) : normalizeBrain(process.env.MIKE_BRAIN || 'auto');
  const wanted = mode === 'auto' ? 'mini' : mode;
  const score = mode === 'auto' ? complexityScore(message) : null;
  const first = availableBrain(wanted);
  if (first !== wanted) console.warn(`[brain] ${wanted} unavailable - using ${first}`);

  const canEscalate = mode === 'auto' && escalationEnabled() && rank(first) < rank(topAvailable());
  const firstTools = canEscalate ? [...(tools || []), ESCALATION_TOOL] : tools;
  const started = Date.now();
  const firstResponse = await runBrain({ brain: first, instructions, input, tools: firstTools, client });
  console.log(`[brain] ${first} (${modelName(first)}) score=${score ?? 'forced'} in ${Date.now() - started}ms`);

  const ask = canEscalate ? findEscalation(firstResponse) : null;
  if (!ask) return stripEscalationCalls(firstResponse);

  const requested = availableBrain(LEVEL_TO_BRAIN[ask.level] || 'terra');
  const ceiling = availableBrain(costCeiling(score ?? 0));
  const capped = rank(requested) > rank(ceiling) ? ceiling : requested;
  const next = rank(capped) > rank(first) ? capped : topAvailable();
  if (rank(next) <= rank(first)) return stripEscalationCalls(firstResponse);

  if (next !== requested) console.log(`[brain] cost cap: requested=${requested} ceiling=${ceiling} mode=${costMode()} score=${score ?? 0}`);
  console.log(`[brain] ${first} -> ${next} (${modelName(next)}) escalated: ${ask.reason}`);
  const escalatedAt = Date.now();
  const escalated = await runBrain({ brain: next, instructions, input, tools, client });
  console.log(`[brain] ${next} (${modelName(next)}) answered escalation in ${Date.now() - escalatedAt}ms`);
  return stripEscalationCalls(escalated);
}

export const BRAIN_MODELS = { ...OPENAI_MODELS, opus: CLAUDE_MODEL };
