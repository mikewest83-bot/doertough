const OPENAI_MODELS = {
  terra: 'gpt-5.6-terra',
  sol: 'gpt-5.6-sol',
};
const CLAUDE_MODEL = 'claude-opus-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const VALID_REASONING = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

const normalizeBrain = (value) => {
  const brain = String(value || '').trim().toLowerCase();
  return ['terra', 'sol', 'opus', 'auto'].includes(brain) ? brain : 'terra';
};

const reasoningEffort = () => {
  const requested = String(process.env.MIKE_REASONING_EFFORT || 'medium').trim().toLowerCase();
  return VALID_REASONING.has(requested) ? requested : 'medium';
};

const complexityScore = (message = '') => {
  const text = String(message).toLowerCase();
  let score = Math.min(3, Math.floor(text.length / 900));
  const hardSignals = [
    'analyze', 'strategy', 'architecture', 'debug', 'debugging', 'code', 'coding',
    'compare', 'research', 'business plan', 'financial model', 'contract', 'legal',
    'multi-step', 'step by step', 'deep dive', 'audit', 'design', 'technical',
    'why is', 'root cause', 'optimize', 'optimization', 'negotiate', 'decision',
  ];
  for (const signal of hardSignals) if (text.includes(signal)) score += 1;
  return score;
};

export function resolveBrain({ message = '', requested = process.env.MIKE_BRAIN || 'terra' } = {}) {
  const mode = normalizeBrain(requested);
  if (mode !== 'auto') return mode;
  const score = complexityScore(message);
  if (score >= 8 && process.env.ANTHROPIC_API_KEY) return 'opus';
  if (score >= 4) return 'sol';
  return 'terra';
}

export function getBrainStatus() {
  const configuredMode = normalizeBrain(process.env.MIKE_BRAIN || 'terra');
  return {
    configuredMode,
    reasoningEffort: reasoningEffort(),
    available: {
      terra: Boolean(process.env.OPENAI_API_KEY),
      sol: Boolean(process.env.OPENAI_API_KEY),
      opus: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    models: { terra: OPENAI_MODELS.terra, sol: OPENAI_MODELS.sol, opus: CLAUDE_MODEL },
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

async function callOpenAI({ model, instructions, input, tools, client }) {
  if (!client) {
    const error = new Error('OPENAI_API_KEY_not_configured');
    error.status = 503;
    throw error;
  }
  return client.responses.create({
    model,
    instructions,
    input,
    tools,
    reasoning: { effort: reasoningEffort() },
  });
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
  const selected = resolveBrain({ message });
  const started = Date.now();
  let response;
  if (selected === 'opus') {
    response = await callClaude({ instructions, input, tools });
  } else {
    response = await callOpenAI({ model: OPENAI_MODELS[selected], instructions, input, tools, client });
  }
  console.log(`[brain] ${selected} (${response?._brain || OPENAI_MODELS[selected]}) completed in ${Date.now() - started}ms`);
  return response;
}

export const BRAIN_MODELS = { ...OPENAI_MODELS, opus: CLAUDE_MODEL };
