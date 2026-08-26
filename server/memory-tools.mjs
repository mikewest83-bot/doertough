// server/memory-tools.mjs
//
// Lets Mike decide, mid-conversation, that something is worth remembering
// and save it himself - rather than only capturing explicit "remember this"
// phrasing. Memory is account-scoped and deliberately bounded.

import { saveMemory } from './memory.mjs';
import { query, dbEnabled } from './db.mjs';

const WRITABLE_CATEGORIES = new Set(['preference', 'goal', 'project', 'context', 'learned']);

const MIN_LENGTH = 4;
const MAX_LENGTH = 300;
const MAX_PER_TURN = 3;
const MAX_PER_ACCOUNT = 250;

// Never let the model decide to persist credentials or other highly sensitive
// identifiers. These are rejected before saveMemory is called.
const SENSITIVE_PATTERNS = [
  { test: /\b(?:\d[ -]*?){13,19}\b/, why: 'what looks like a card number' },
  { test: /\b\d{3}-\d{2}-\d{4}\b/, why: 'what looks like a Social Security number' },
  { test: /\b(pass(word|code)|\bpin\b|api[ _-]?key|secret key|routing number|account number|social security|cvv)\b/i, why: 'account or credential details' },
  { test: /\b(sk|pk)-[A-Za-z0-9]{16,}\b/, why: 'what looks like an API key' },
];

function screen(text) {
  for (const { test, why } of SENSITIVE_PATTERNS) {
    if (test.test(text)) return why;
  }
  return null;
}

export async function rememberThis(args = {}, ctx = {}) {
  const user = ctx.user;
  if (!user?.id) {
    return {
      saved: false,
      reason: 'no_account',
      note: 'Memory is tied to an account. Tell them they can make a free account and you will start remembering things for them.',
    };
  }
  if (!dbEnabled) {
    return { saved: false, reason: 'unavailable', note: 'Memory storage is not available right now.' };
  }

  const memory = String(args.memory || '').trim();
  const category = String(args.category || 'context').trim().toLowerCase();

  if (memory.length < MIN_LENGTH) {
    return { saved: false, reason: 'too_short', note: 'That was not specific enough to be worth storing.' };
  }
  if (memory.length > MAX_LENGTH) {
    return { saved: false, reason: 'too_long', note: `Keep it under ${MAX_LENGTH} characters - one clear fact, not a summary of the conversation.` };
  }
  if (!WRITABLE_CATEGORIES.has(category)) {
    return { saved: false, reason: 'bad_category', note: `Category must be one of: ${[...WRITABLE_CATEGORIES].join(', ')}.` };
  }

  const sensitive = screen(memory);
  if (sensitive) {
    console.warn(`[memory-tools] refused a save containing ${sensitive} for account #${user.id}`);
    return {
      saved: false,
      reason: 'sensitive',
      note: `Not saving that - it contains ${sensitive}. Tell them plainly you do not keep that kind of detail, and move on.`,
    };
  }

  // Per-turn cap. ctx.memoryWrites is created fresh for each request.
  ctx.memoryWrites = (ctx.memoryWrites || 0) + 1;
  if (ctx.memoryWrites > MAX_PER_TURN) {
    return { saved: false, reason: 'turn_limit', note: 'That is enough for one exchange. Save the most important thing only.' };
  }

  // Per-account cap prevents unbounded growth. This is intentionally a
  // lightweight guard; saveMemory remains the single write path.
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM user_memories WHERE user_id = $1 AND active = true`,
      [user.id]
    );
    if ((rows[0]?.n || 0) >= MAX_PER_ACCOUNT) {
      return {
        saved: false,
        reason: 'account_limit',
        note: 'Their memory is full. Tell them they can clear some out before you add more.',
      };
    }
  } catch (err) {
    console.error('[memory-tools] count failed:', err.message || err);
    // Do not turn a temporary count failure into a memory outage.
  }

  try {
    const saved = await saveMemory(user.id, {
      category,
      memory,
      importance: args.importance,
      source: 'mike-tool',
    });
    if (!saved) return { saved: false, reason: 'rejected', note: 'That could not be stored.' };
    console.log(`[memory-tools] saved ${category} memory for account #${user.id}`);
    return {
      saved: true,
      category,
      memory,
      note: 'Stored. Mention naturally that you will remember it - do not make a production of it.',
    };
  } catch (err) {
    console.error('[memory-tools] save failed:', err.message || err);
    return { saved: false, reason: 'error', note: 'That could not be stored right now.' };
  }
}

export const MEMORY_TOOLS = [
  {
    type: 'function',
    name: 'remember_this',
    description:
      "Store one durable fact about the person you're talking to, so you still know it in future conversations. Use it for things that stay true - their trade, crew size, equipment, the town they work in, how they like answers, a project they're in the middle of. Do NOT use it for one-off questions, passing small talk, anything you worked out yourself rather than being told, or anything they'd be uncomfortable seeing written down. One clear fact per call.",
    parameters: {
      type: 'object',
      properties: {
        memory: {
          type: 'string',
          description: "The fact, written plainly in the third person, e.g. 'Runs a three-man framing crew out of Summerville' or 'Prefers short answers with the number first'.",
        },
        category: {
          type: 'string',
          enum: ['preference', 'goal', 'project', 'context', 'learned'],
          description: "preference = how they like things done; goal = something they're working toward; project = a specific job in progress; context = stable background about them or their business; learned = something you worked out about how to help them best.",
        },
        importance: {
          type: 'integer',
          description: '1-5. Use 4 or 5 only for things that shape most conversations, like their trade or how they want to be talked to.',
        },
      },
      required: ['memory', 'category'],
      additionalProperties: false,
    },
  },
];

export const MEMORY_TOOL_HANDLERS = {
  remember_this: rememberThis,
};
