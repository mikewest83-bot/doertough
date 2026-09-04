// Mike Memory v2
// Persistent, account-scoped memory stored in the same PostgreSQL database used
// by Mike's accounts and conversations. This module deliberately keeps memory
// separate from Mike's personality instructions so personality can evolve
// without rewriting what Mike has learned about a user.
import { query, dbEnabled } from './db.mjs';
import {
  getOperatingSnapshot,
  operatingSystemPrompt,
  setCurrentFocus,
  updateFocus,
  addAction,
  completeAction,
  recordDecision,
  recordPattern,
} from './operating-system.mjs';

let ready = false;

const CATEGORIES = new Set(['preference', 'goal', 'project', 'context', 'learned', 'operating_system']);
const MEMORY_CATEGORIES = new Set(['preference', 'goal', 'project', 'context', 'learned']);

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

function tokenize(value, maxWords = 24) {
  return clean(value, 1200)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .slice(0, maxWords);
}

function daysSince(value) {
  if (!value) return 365;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 365;
  return Math.max(0, (Date.now() - time) / 86_400_000);
}

function memoryScore(memory, words) {
  const text = String(memory.memory || '').toLowerCase();
  const matches = new Set(words.filter((word) => text.includes(word)));
  const lexical = matches.size;
  const importance = Math.min(5, Math.max(1, Number(memory.importance) || 3));
  const recencyDays = daysSince(memory.last_used_at || memory.updated_at || memory.created_at);
  const recency = Math.max(0, 6 - Math.min(6, recencyDays / 14));

  // Durable facts stay valuable, but memories that actually match the current
  // conversation rise to the top. Recently useful memories get a modest boost.
  // This prevents the old "first 12 memories" behavior from crowding out what
  // matters to the current turn.
  const categoryBoost = memory.category === 'goal' || memory.category === 'project' ? 1.5 : 0;
  return (importance * 8) + (lexical * 14) + recency + categoryBoost;
}

async function listOperatingMemories(userId) {
  const snapshot = await getOperatingSnapshot(userId);
  if (!snapshot) return [];
  const out = [];
  for (const item of snapshot.focus || []) out.push({ id: `os:focus:${item.id}`, category: 'operating_system', memory: `FOCUS: ${item.title}${item.description ? ` — ${item.description}` : ''}`, importance: item.priority === 'critical' ? 5 : item.priority === 'high' ? 4 : 3, source: 'mike-os', ...item });
  for (const item of snapshot.actions || []) out.push({ id: `os:action:${item.id}`, category: 'operating_system', memory: `ACTION: ${item.title}`, importance: item.priority === 'critical' ? 5 : item.priority === 'high' ? 4 : 3, source: 'mike-os', ...item });
  for (const item of snapshot.decisions || []) out.push({ id: `os:decision:${item.id}`, category: 'operating_system', memory: `DECISION: ${item.decision}`, importance: 4, source: 'mike-os', ...item });
  for (const item of snapshot.patterns || []) out.push({ id: `os:pattern:${item.id}`, category: 'operating_system', memory: `PATTERN: ${item.pattern}`, importance: item.confidence, source: 'mike-os', ...item });
  return out;
}

async function saveOperatingMemory(userId, payload) {
  let data = payload;
  if (typeof payload === 'string') {
    try { data = JSON.parse(payload); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  const type = clean(data.type, 30).toLowerCase();
  const action = clean(data.action || 'create', 30).toLowerCase();

  if (type === 'focus') {
    if (action === 'update') return updateFocus(userId, data.id, data);
    if (action === 'complete') return updateFocus(userId, data.id, { status: 'done' });
    return setCurrentFocus(userId, data);
  }
  if (type === 'action') {
    if (action === 'complete') return completeAction(userId, data.id, data.outcome || '');
    return addAction(userId, data);
  }
  if (type === 'decision') return recordDecision(userId, data);
  if (type === 'pattern') return recordPattern(userId, data);
  return null;
}

async function deleteOperatingMemory(userId, id) {
  const [prefix, type, rawId] = String(id || '').split(':');
  if (prefix !== 'os' || !type || !rawId) return false;
  if (!dbEnabled) return false;
  const table = type === 'focus' ? 'mike_focus' : type === 'action' ? 'mike_actions' : type === 'decision' ? 'mike_decisions' : type === 'pattern' ? 'mike_patterns' : null;
  if (!table) return false;
  const result = type === 'pattern'
    ? await query(`UPDATE ${table} SET active = false, updated_at = now() WHERE id = $1 AND user_id = $2 AND active = true`, [rawId, userId])
    : await query(`UPDATE ${table} SET status = 'abandoned', updated_at = now() WHERE id = $1 AND user_id = $2 AND status <> 'abandoned'`, [rawId, userId]);
  return result.rowCount > 0;
}

export async function saveMemory(userId, { category, memory, importance = 3, source = 'conversation' }) {
  if (!userId) return null;
  if (category === 'operating_system') return saveOperatingMemory(userId, memory);
  if (!MEMORY_CATEGORIES.has(category) || !(await ensureMemorySchema())) return null;
  const safeCategory = category;
  const safeMemory = clean(memory);
  if (!safeMemory) return null;
  const safeImportance = Math.min(5, Math.max(1, Math.round(Number(importance) || 3)));

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
  if (!userId) return [];
  if (category === 'operating_system') return (await listOperatingMemories(userId)).slice(0, Math.min(200, Math.max(1, Math.round(Number(limit) || 100))));
  if (!(await ensureMemorySchema())) return [];
  const safeLimit = Math.min(200, Math.max(1, Math.round(Number(limit) || 100)));
  if (category && MEMORY_CATEGORIES.has(category)) {
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

async function learnExplicitMemory(userId, queryText) {
  const text = clean(queryText, 1200);
  const match = text.match(/^(?:please\s+)?(?:remember|don't\s+forget|do\s+not\s+forget|keep\s+in\s+mind|from\s+now\s+on|going\s+forward)\s+(?:that\s+)?(.+)$/i);
  if (!match) return null;
  const memory = clean(match[1], 1000);
  if (!memory) return null;
  return saveMemory(userId, {
    category: 'context',
    memory,
    importance: 5,
    source: 'explicit-user',
  });
}

export async function getRelevantMemories(userId, queryText, limit = 12) {
  if (!userId || !(await ensureMemorySchema())) return [];
  await learnExplicitMemory(userId, queryText).catch((err) => console.error('[memory] explicit learn failed:', err.message || err));

  const words = tokenize(queryText);
  const safeLimit = Math.min(50, Math.max(1, Math.round(Number(limit) || 12)));

  // Pull a bounded candidate set, then rank in application code using lexical
  // relevance + importance + recent usefulness. This is deliberately account
  // scoped and small (the account write cap is 250) so the ranking stays cheap.
  const { rows: candidates } = await query(
    `SELECT id, category, memory, importance, source, created_at, updated_at, last_used_at
       FROM user_memories
      WHERE user_id = $1 AND active = true
      ORDER BY importance DESC, updated_at DESC
      LIMIT 200`,
    [userId]
  );

  const ranked = candidates
    .map((memory) => ({ ...memory, _score: memoryScore(memory, words) }))
    .sort((a, b) => b._score - a._score || Number(b.importance) - Number(a.importance) || new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, safeLimit)
    .map(({ _score, ...memory }) => memory);

  if (ranked.length) {
    await query(
      `UPDATE user_memories SET last_used_at = now()
        WHERE id = ANY($1::bigint[])`,
      [ranked.map((r) => r.id)]
    ).catch(() => {});
  }

  return addOperatingContext(userId, ranked);
}

export async function deleteMemory(userId, id) {
  if (!userId) return false;
  if (String(id).startsWith('os:')) return deleteOperatingMemory(userId, id);
  if (!(await ensureMemorySchema())) return false;
  const value = String(id || '').trim();
  if (!/^\d+$/.test(value)) return false;
  const { rowCount } = await query(
    `UPDATE user_memories SET active = false, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND active = true`,
    [value, userId]
  );
  return rowCount > 0;
}

export function memoryPrompt(memories) {
  if (!memories?.length) return '';
  const lines = memories.map((m) => `- [${m.category}] ${m.memory}`);
  return `\n\nMIKE MEMORY — RELEVANT USER CONTEXT\nUse these memories when they genuinely help. Do not mention the memory system unless asked. Do not treat a memory as a current fact if the user's current message contradicts it. Prefer the user's active goals/projects and stable preferences when they materially improve the answer. Never bring up a personal detail merely to prove that you remember it. If a memory is not relevant to the current task, ignore it.\n${lines.join('\n')}`;
}

export { CATEGORIES };
