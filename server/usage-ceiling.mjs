// server/usage-ceiling.mjs
// Durable per-account daily ceilings for expensive Mike AI endpoints.
// The table is created lazily so this module never becomes a boot-time
// dependency on a separate migration step.

import { query, dbEnabled } from './db.mjs';

const DEFAULT_ASK_LIMIT = 100;
const DEFAULT_VISION_LIMIT = 25;

const ASK_LIMIT = Number(process.env.MIKE_DAILY_ASK_LIMIT || DEFAULT_ASK_LIMIT);
const VISION_LIMIT = Number(process.env.MIKE_DAILY_VISION_LIMIT || DEFAULT_VISION_LIMIT);

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS daily_usage (
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  ask_count INT NOT NULL DEFAULT 0,
  vision_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);
`;

let tableReady = false;
let tablePromise = null;

async function ensureTable() {
  if (!dbEnabled) return false;
  if (tableReady) return true;
  if (!tablePromise) {
    tablePromise = query(TABLE_SQL)
      .then(() => {
        tableReady = true;
        return true;
      })
      .catch((error) => {
        tablePromise = null;
        throw error;
      });
  }
  return tablePromise;
}

function limitFor(path) {
  if (path === '/api/vision/analyze' || path.startsWith('/api/vision/analyze/')) {
    return { column: 'vision_count', limit: VISION_LIMIT };
  }
  return { column: 'ask_count', limit: ASK_LIMIT };
}

export function isDailyLimited(path) {
  return path === '/api/ask'
    || path.startsWith('/api/ask/')
    || path === '/api/vision/analyze'
    || path.startsWith('/api/vision/analyze/');
}

export async function consumeDaily(userId, path) {
  if (!dbEnabled) return { ok: true, used: 0, limit: limitFor(path).limit };
  await ensureTable();

  const { column, limit } = limitFor(path);

  // Atomic upsert prevents concurrent requests from racing past the ceiling.
  // The increment happens before the expensive request, so rejected/abandoned
  // requests consume the allowance rather than creating an unbounded cost path.
  const sql = `
    INSERT INTO daily_usage (user_id, usage_date, ${column})
    VALUES ($1, CURRENT_DATE, 1)
    ON CONFLICT (user_id, usage_date)
    DO UPDATE SET ${column} = daily_usage.${column} + 1
    RETURNING ${column} AS used
  `;

  const { rows: [row] } = await query(sql, [userId]);
  const used = Number(row?.used || 0);

  return {
    ok: used <= limit,
    used,
    limit,
  };
}

export function secondsUntilReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
}
