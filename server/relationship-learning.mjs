// Low-risk relationship learning for Mike.
// Learns interaction style from repeated explicit behavior, not sensitive traits.

import { query, dbEnabled } from './db.mjs';

const MAX_PATTERN_LENGTH = 240;
const MIN_EVIDENCE_FOR_CONFIDENT = 2;
const MAX_SIGNALS_PER_TURN = 2;

const SIGNALS = [
  { key: 'concise_answers', pattern: 'Prefers concise, action-oriented answers', terms: [/short answer/i, /keep it short/i, /just give me the answer/i, /be concise/i] },
  { key: 'detailed_answers', pattern: 'Prefers detailed explanations when requested', terms: [/give me the details/i, /detailed version/i, /go in depth/i, /explain it fully/i] },
  { key: 'recommendation_first', pattern: 'Prefers a clear recommendation before alternatives', terms: [/what do you recommend/i, /just tell me what you would do/i, /give me your recommendation/i] },
  { key: 'action_first', pattern: 'Prefers moving from planning to concrete action quickly', terms: [/go ahead/i, /let.s do it/i, /keep going/i, /make it happen/i, /do it/i] },
  { key: 'challenge_me', pattern: 'Wants weak ideas or assumptions challenged directly', terms: [/challenge me/i, /call me out/i, /tell me if i.m wrong/i, /don.t just agree/i] },
];

function detectSignals(message) {
  const text = String(message || '').trim();
  if (!text) return [];
  return SIGNALS.filter((signal) => signal.terms.some((term) => term.test(text))).slice(0, MAX_SIGNALS_PER_TURN);
}

function clampConfidence(value) {
  return Math.max(1, Math.min(5, Number(value) || 1));
}

export async function learnFromInteraction(userId, message) {
  if (!userId || !dbEnabled) return { observed: 0 };
  const signals = detectSignals(message);
  if (!signals.length) return { observed: 0 };

  let observed = 0;
  for (const signal of signals) {
    const pattern = signal.pattern.slice(0, MAX_PATTERN_LENGTH);
    try {
      const existing = await query(
        `SELECT id, confidence, evidence_count FROM mike_patterns
         WHERE user_id = $1 AND pattern = $2 AND active = true
         LIMIT 1`,
        [userId, pattern]
      );
      const row = existing.rows[0];
      if (row) {
        const evidence = Math.min(100, Number(row.evidence_count || 0) + 1);
        const confidence = clampConfidence(Math.min(5, Math.max(Number(row.confidence || 1), Math.ceil(evidence / 2))));
        await query(
          `UPDATE mike_patterns
           SET evidence_count = $1, confidence = $2, last_observed_at = NOW()
           WHERE id = $3 AND user_id = $4`,
          [evidence, confidence, row.id, userId]
        );
      } else {
        await query(
          `INSERT INTO mike_patterns (user_id, pattern, confidence, evidence_count, last_observed_at, active)
           VALUES ($1, $2, $3, 1, NOW(), true)`,
          [userId, pattern, 1, 1]
        );
      }
      observed += 1;
    } catch (error) {
      console.error('[relationship-learning] signal failed:', error.message || error);
    }
  }
  return { observed };
}

export function relationshipLearningPrompt(patterns = []) {
  if (!patterns?.length) return '';
  const usable = patterns
    .filter((item) => Number(item.evidence_count || 0) >= MIN_EVIDENCE_FOR_CONFIDENT)
    .slice(0, 8);
  if (!usable.length) return '';
  const lines = usable.map((item) => `- ${item.pattern} (evidence: ${item.evidence_count})`).join('\n');
  return `\n\nRELATIONSHIP LEARNING\nThese are evidence-backed interaction preferences, not fixed traits:\n${lines}\nUse them to adapt how you help. The current user request always overrides them. Never mention the scoring system unless asked.`;
}

export const RELATIONSHIP_SIGNAL_KEYS = Object.freeze(SIGNALS.map((signal) => signal.key));
