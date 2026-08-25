// Mike Memory v1
// Persistent, account-scoped memory stored in the same PostgreSQL database used
// by Mike's accounts and conversations. This module deliberately keeps memory
// separate from Mike's personality instructions so personality can evolve
// without rewriting what Mike has learned about a user.
import { query, dbEnabled } from './db.mjs';
import { getOperatingSnapshot, operatingSystemPrompt } from './operating-system.mjs';

let ready = false;

const CATEGORIES = new Set(['preference', 'goal', 'project', 'context', 'learned']);

async function ensureMemorySchema() {
  if (!dbEnabled || ready) return dbEnabled;
  await query(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('preference','goal','project','context','learned')),
      memory TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'conversation',
      importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT true
    );
    CREATE INDEX IF NOT EXISTS user_memories_user_active_idx
      ON user_memories (user_id, active, updated_at DESC);
    CREATE INDEX IF NOT EXISTS user_memories_user_category_idx
      ON user_memories (user_id, category, active);
  `);
  ready = true;
  return true;
}

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

export async function saveMemory(userId, { category, memory, importance = 3, source = 'conversation' }) {
  if (!userId || !(await ensureMemorySchema())) return null;
  const safeCategory = CATEGORIES.has(category) ? category : 'context';
  const safeMemory = clean(memory);
  if (!safeMemory) return null;
  const safeImportance = Math.min(5, Math.max(1, Math.round(Number(importance) || 3)));

  // Avoid accumulating near-duplicate memories. Exact matches are refreshed;
  // materially different memories remain separate so history is not silently
  // overwritten.
  const existing = await query(
    `SELECT id FROM user_memories
      WHERE user_id = $1 AND category = $2 AND active = true AND lower(memory) = lower($3)
      LIMIT 1`,
    [userId, safeCategory, safeMemory]
  );
  if (existing.rows[0]) {
    const { rows } = await query(
      `UPDATE user_memories
          SET importance = GREATEST(importance, $2), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, safeImportance]
    );
    return rows[0];
  }

  const { rows } = await query(
    `INSERT INTO user_memories (user_id, category, memory, source, importance)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, safeCategory, safeMemory, clean(source, 60), safeImportance]
  );
  return rows[0];
}

export async function listMemories(userId, { category, limit = 100 } = {}) {
  if (!userId || !(await ensureMemorySchema())) return [];
  const safeLimit = Math.min(200, Math.max(1, Math.round(Number(limit) || 100)));
  if (category && CATEGORIES.has(category)) {
    const { rows } = await query(
      `SELECT id, category, memory, importance, source, created_at, updated_at, last_used_at
         FROM user_memories
        WHERE user_id = $1 AND active = true AND category = $2
        ORDER BY importance DESC, updated_at DESC LIMIT $3`,
      [userId, category, safeLimit]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT id, category, memory, importance, source, created_at, updated_at, last_used_at
       FROM user_memories
      WHERE user_id = $1 AND active = true
      ORDER BY importance DESC, updated_at DESC LIMIT $2`,
    [userId, safeLimit]
  );
  return rows;
}

async function addOperatingContext(userId, memories) {
  try {
    const snapshot = await getOperatingSnapshot(userId);
    if (!snapshot) return memories;
    const hasContext = [snapshot.focus, snapshot.actions, snapshot.decisions, snapshot.patterns]
      .some((items) => Array.isArray(items) && items.length > 0);
    if (!hasContext) return memories;

    return [
      ...memories,
      {
        category: 'operating_system',
        memory: operatingSystemPrompt(snapshot).replace(/^\n\nMIKE PERSONAL OPERATING SYSTEM — CURRENT CONTEXT\n/, ''),
        importance: 5,
        source: 'mike-os',
      },
    ];
  } catch (err) {
    console.error('[memory] operating-system context failed:', err.message || err);
    return memories;
  }
}

export async function getRelevantMemories(userId, queryText, limit = 12) {
  if (!userId || !(await ensureMemorySchema())) return [];
  const words = clean(queryText, 800).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).slice(0, 12);
  if (!words.length) return addOperatingContext(userId, await listMemories(userId, { limit }));

  // Lightweight lexical retrieval keeps v1 dependency-free. We can replace
  // this with embeddings later without changing the memory API.
  const clauses = words.map((_, i) => `memory ILIKE $${i + 2}`).join(' OR ');
  const params = [userId, ...words.map((w) => `%${w}%`), Math.min(50, Math.max(1, limit))];
  const { rows } = await query(
    `SELECT id, category, memory, importance, source, created_at, updated_at, last_used_at
       FROM user_memories
      WHERE user_id = $1 AND active = true AND (${clauses})
      ORDER BY importance DESC, updated_at DESC
      LIMIT $${params.length}`,
    params
  );

  if (rows.length) {
    await query(
      `UPDATE user_memories SET last_used_at = now()
        WHERE id = ANY($1::bigint[])`,
      [rows.map((r) => r.id)]
    ).catch(() => {});
  }
  return addOperatingContext(userId, rows);
}

export async function deleteMemory(userId, id) {
  if (!userId || !(await ensureMemorySchema())) return false;
  const { rowCount } = await query(
    `UPDATE user_memories SET active = false, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND active = true`,
    [id, userId]
  );
  return rowCount > 0;
}

export function memoryPrompt(memories) {
  if (!memories?.length) return '';
  const lines = memories.map((m) => `- [${m.category}] ${m.memory}`);
  return `\n\nMIKE MEMORY — RELEVANT USER CONTEXT\nUse these memories when they genuinely help. Do not mention the memory system unless asked. Do not treat a memory as a current fact if the user's current message contradicts it.\n${lines.join('\n')}`;
}

export { CATEGORIES };
