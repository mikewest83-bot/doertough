// server/deep-think.mjs
//
// Brings the brain router to VOICE.
//
// Text chat routes every turn through brain-router (mini -> terra -> sol ->
// opus). Voice cannot work that way: the browser holds a WebRTC connection
// straight to OpenAI, the server is not in the audio path, and the realtime
// model is fixed when the session opens. So voice gets the deep brains the
// only way it can - as a tool it calls on itself.
//
// gpt-realtime is a capable model; this is not a crutch for a weak one. It is
// the same escalation the text path already has, expressed as the one
// mechanism voice does have back to the server.
//
// Cost note: opus is CHEAPER per token than the realtime model already doing
// the talking ($5/$25 vs $32/$64 for audio), and idle time during the call is
// not billed - VAD filters silence. The throttle below exists to stop a loop,
// not because the call is expensive.
import OpenAI from 'openai';
import { generateBrainResponse } from './brain-router.mjs';

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// A spoken answer has different constraints than a written one: no headings,
// no bullet lists, and it has to survive being read aloud in one pass.
const DEEP_INSTRUCTIONS = [
  'You are the deep-reasoning brain behind Mike, a Doer Tough assistant for tradespeople and small business owners.',
  'Mike has handed you a question he judged too hard to answer off the cuff. Work it through properly.',
  'Your answer will be SPOKEN ALOUD, so: no markdown, no headings, no bullet points, no numbered lists.',
  'Talk like a person who knows the trade. Short sentences. Lead with the answer, then the reasoning that matters.',
  'Keep it under about 180 words - this is a conversation, not a report.',
  'Use only the facts you were given. If a number was not supplied, say what it depends on rather than inventing it.',
].join(' ');

const TIMEOUT_MS = Number(process.env.MIKE_DEEP_TIMEOUT_MS || 25000);
const PER_HOUR = Number(process.env.MIKE_DEEP_PER_HOUR || 6);
const DEEP_BRAIN = process.env.MIKE_DEEP_BRAIN || 'opus';

// userId -> { count, resetAt }. Per-process, same as the guard's fast pass.
// A voice model that decides everything is hard could otherwise call this on
// every turn, and each call is a full deep-model request.
const calls = new Map();

function withinBudget(userId) {
  if (!userId) return true;
  const now = Date.now();
  const entry = calls.get(userId);
  if (!entry || now > entry.resetAt) {
    calls.set(userId, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= PER_HOUR;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of calls) if (now > entry.resetAt) calls.delete(id);
}, 600_000).unref?.();

export const DEEP_THINK_TOOLS = [
  {
    type: 'function',
    name: 'think_harder',
    description: [
      'Hand a hard question to a stronger reasoning model and speak its answer.',
      'Call this when the question needs sustained reasoning you cannot do while talking:',
      'several constraints that interact, a costly decision where the obvious answer is probably wrong,',
      'a comparison with real trade-offs, or a plan whose steps depend on each other.',
      'Do NOT call it for a lookup, a price check, a definition, arithmetic, or anything another tool answers.',
      'A short spoken question can still be a hard one - judge the problem, not the word count.',
      'IMPORTANT: say something first, like "let me think on that a second", THEN call this.',
      'It takes a few seconds and the user should not sit in silence wondering if you are still there.',
      'Pass every relevant fact you already have in `facts` - the stronger model cannot see the conversation or call tools.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: "The user's question, in full, in your own words if they were unclear." },
        facts: { type: 'string', description: 'Everything relevant you already know or looked up: numbers, prices, dates, tool results, constraints the user mentioned.' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
];

async function thinkHarder({ question, facts, user } = {}) {
  const q = String(question || '').trim();
  if (!q) return { error: 'question_required' };
  if (!client) return { error: 'deep_reasoning_unavailable', say: "I can't reach my deeper reasoning right now. Let me give you my own read instead." };
  if (!withinBudget(user?.id)) {
    console.warn(`[deep-think] hourly cap reached for user:${user?.id}`);
    return { capped: true, say: "I've been digging deep a lot this hour. Let me answer this one myself." };
  }

  const detail = String(facts || '').trim();
  const prompt = detail ? `${q}\n\nWhat I already know:\n${detail}` : q;
  const input = [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }];

  const started = Date.now();
  try {
    // Tools are deliberately omitted: the voice model has already gathered
    // what it needs and passed it in `facts`. This call is pure reasoning, so
    // there is no tool-resolution loop to run and nothing can stall on one.
    const response = await Promise.race([
      generateBrainResponse({ client, instructions: DEEP_INSTRUCTIONS, input, tools: [], message: q, brain: DEEP_BRAIN }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('deep_think_timeout')), TIMEOUT_MS)),
    ]);
    const answer = String(response?.output_text || '').trim();
    if (!answer) throw new Error('deep_think_empty');
    console.log(`[deep-think] answered in ${Date.now() - started}ms (${answer.length} chars)`);
    return { answer };
  } catch (error) {
    const reason = error?.message || 'deep_think_failed';
    console.error(`[deep-think] ${reason} after ${Date.now() - started}ms`);
    // Never leave Mike mid-sentence with nothing to say.
    return { error: reason, say: "I couldn't get all the way to the bottom of that one. Here's my own read on it." };
  }
}

export const DEEP_THINK_HANDLERS = { think_harder: thinkHarder };
