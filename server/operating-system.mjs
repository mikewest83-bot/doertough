// Mike AI Personal Operating System v1
// Account-scoped operating context built on top of Mike Memory.
// This module deliberately stays separate from persona.mjs and the voice engine.
import { query, dbEnabled } from './db.mjs';

let ready = false;

const STATUS = new Set(['next', 'active', 'blocked', 'done', 'parked', 'abandoned']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

async function ensureOperatingSystemSchema() {
  if (!dbEnabled || ready) return dbEnabled;

  await query(`
    CREATE TABLE IF NOT EXISTS mike_focus (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'high' CHECK (priority IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('next','active','blocked','done','parked','abandoned')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS mike_actions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      focus_id BIGINT REFERENCES mike_focus (id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'next' CHECK (status IN ('next','active','blocked','done','parked','abandoned')),
      priority TEXT NOT NULL DEFAULT 'high' CHECK (priority IN ('low','medium','high','critical')),
      blocked_by TEXT,
      outcome TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS mike_decisions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      reasoning TEXT,
      outcome TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mike_patterns (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      confidence SMALLINT NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 1 AND 5),
      evidence_count INT NOT NULL DEFAULT 1,
      last_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS mike_focus_user_status_idx ON mike_focus (user_id, status, priority, updated_at DESC);
    CREATE INDEX IF NOT EXISTS mike_actions_user_status_idx ON mike_actions (user_id, status, priority, updated_at DESC);
    CREATE INDEX IF NOT EXISTS mike_decisions_user_idx ON mike_decisions (user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS mike_patterns_user_idx ON mike_patterns (user_id, active, confidence DESC, updated_at DESC);
  `);

  ready = true;
  return true;
}

const clean = (value, max = 1200) => String(value || '').trim().slice(0, max);
const safePriority = (value) => PRIORITIES.has(value) ? value : 'medium';
const safeStatus = (value) => STATUS.has(value) ? value : 'active';

export async function getOperatingSnapshot(userId) {
  if (!userId || !(await ensureOperatingSystemSchema())) return null;

  const [focus, actions, decisions, patterns] = await Promise.all([
    query(`SELECT id, title, description, priority, status, created_at, updated_at, completed_at
             FROM mike_focus
            WHERE user_id = $1 AND status NOT IN ('done','abandoned')
            ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                     updated_at DESC LIMIT 20`, [userId]),
    query(`SELECT id, focus_id, title, status, priority, blocked_by, outcome, created_at, updated_at, completed_at
             FROM mike_actions
            WHERE user_id = $1 AND status NOT IN ('done','abandoned')
            ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'next' THEN 2 WHEN 'blocked' THEN 3 ELSE 4 END,
                     CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                     updated_at DESC LIMIT 30`, [userId]),
    query(`SELECT id, decision, reasoning, outcome, status, created_at, updated_at
             FROM mike_decisions
            WHERE user_id = $1
            ORDER BY updated_at DESC LIMIT 20`, [userId]),
    query(`SELECT id, pattern, confidence, evidence_count, last_observed_at, created_at, updated_at
             FROM mike_patterns
            WHERE user_id = $1 AND active = true
            ORDER BY confidence DESC, evidence_count DESC, updated_at DESC LIMIT 20`, [userId]),
  ]);

  return {
    focus: focus.rows,
    actions: actions.rows,
    decisions: decisions.rows,
    patterns: patterns.rows,
  };
}

export async function setCurrentFocus(userId, { title, description = '', priority = 'high' }) {
  if (!userId || !(await ensureOperatingSystemSchema())) return null;
  const safeTitle = clean(title, 240);
  if (!safeTitle) return null;
  const { rows } = await query(
    `INSERT INTO mike_focus (user_id, title, description, priority, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
    [userId, safeTitle, clean(description), safePriority(priority)]
  );
  return rows[0] || null;
}

export async function updateFocus(userId, id, updates = {}) {
  if (!userId || !(await ensureOperatingSystemSchema())) return null;
  const status = updates.status ? safeStatus(updates.status) : null;
  const priority = updates.priority ? safePriority(updates.priority) : null;
  const title = updates.title ? clean(updates.title, 240) : null;
  const description = updates.description !== undefined ? clean(updates.description) : null;
  const { rows } = await query(
    `UPDATE mike_focus SET
       title = COALESCE($3, title),
       description = COALESCE($4, description),
       priority = COALESCE($5, priority),
       status = COALESCE($6, status),
       updated_at = now(),
       completed_at = CASE WHEN $6 = 'done' THEN COALESCE(completed_at, now()) ELSE completed_at END
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [id, userId, title, description, priority, status]
  );
  return rows[0] || null;
}

export async function addAction(userId, { title, focusId = null, priority = 'high', status = 'next', blockedBy = '' }) {
  if (!userId || !(await ensureOperatingSystemSchema())) return null;
  const safeTitle = clean(title, 300);
  if (!safeTitle) return null;
  const { rows } = await query(
    `INSERT INTO mike_actions (user_id, focus_id, title, priority, status, blocked_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, focusId || null, safeTitle, safePriority(priority), safeStatus(status), clean(blockedBy, 500)]
  );
  return rows[0] || null;
}

export async function completeAction(userId, id, outcome = '') {
  if (!userId || !(await ensureOperatingSystemSchema())) return false;
  const { rowCount } = await query(
    `UPDATE mike_actions
        SET status = 'done', outcome = $3, updated_at = now(), completed_at = now()
      WHERE id = $1 AND user_id = $2`,
    [id, userId, clean(outcome, 1000)]
  );
  return rowCount > 0;
}

export async function recordDecision(userId, { decision, reasoning = '', outcome = '' }) {
  if (!userId || !(await ensureOperatingSystemSchema())) return null;
  const safeDecision = clean(decision, 800);
  if (!safeDecision) return null;
  const { rows } = await query(
    `INSERT INTO mike_decisions (user_id, decision, reasoning, outcome)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, safeDecision, clean(reasoning, 1500), clean(outcome, 1000)]
  );
  return rows[0] || null;
}

export async function recordPattern(userId, { pattern, confidence = 1, evidenceCount = 1 }) {
  if (!userId || !(await ensureOperatingSystemSchema())) return null;
  const safePattern = clean(pattern, 1000);
  if (!safePattern) return null;
  const safeConfidence = Math.min(5, Math.max(1, Math.round(Number(confidence) || 1)));
  const safeEvidence = Math.max(1, Math.round(Number(evidenceCount) || 1));

  const existing = await query(
    `SELECT id FROM mike_patterns WHERE user_id = $1 AND active = true AND lower(pattern) = lower($2) LIMIT 1`,
    [userId, safePattern]
  );
  if (existing.rows[0]) {
    const { rows } = await query(
      `UPDATE mike_patterns
          SET confidence = GREATEST(confidence, $2), evidence_count = GREATEST(evidence_count, $3),
              last_observed_at = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, safeConfidence, safeEvidence]
    );
    return rows[0] || null;
  }

  const { rows } = await query(
    `INSERT INTO mike_patterns (user_id, pattern, confidence, evidence_count)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, safePattern, safeConfidence, safeEvidence]
  );
  return rows[0] || null;
}

export function operatingSystemPrompt(snapshot) {
  if (!snapshot) return '';
  const lines = [];
  if (snapshot.focus?.length) lines.push(`CURRENT FOCUS:\n${snapshot.focus.slice(0, 5).map((x) => `- ${x.title} [${x.priority}/${x.status}]${x.description ? ` — ${x.description}` : ''}`).join('\n')}`);
  if (snapshot.actions?.length) lines.push(`NEXT ACTIONS:\n${snapshot.actions.slice(0, 8).map((x) => `- ${x.title} [${x.priority}/${x.status}]${x.blocked_by ? ` — blocked by: ${x.blocked_by}` : ''}`).join('\n')}`);
  if (snapshot.decisions?.length) lines.push(`RECENT DECISIONS:\n${snapshot.decisions.slice(0, 5).map((x) => `- ${x.decision}${x.reasoning ? ` — why: ${x.reasoning}` : ''}${x.outcome ? ` — outcome: ${x.outcome}` : ''}`).join('\n')}`);
  if (snapshot.patterns?.length) lines.push(`LEARNED PATTERNS:\n${snapshot.patterns.slice(0, 8).map((x) => `- ${x.pattern} [confidence ${x.confidence}/5, evidence ${x.evidence_count}]`).join('\n')}`);
  if (!lines.length) return '';
  return `\n\nMIKE PERSONAL OPERATING SYSTEM — CURRENT CONTEXT\nUse this context to improve continuity and recommendations. Current user statements override stale context. Do not mention these internal sections unless asked. Do not treat patterns as facts; treat them as evidence-backed hypotheses.\n${lines.join('\n\n')}`;
}

export { STATUS, PRIORITIES };
