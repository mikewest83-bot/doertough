// Mike continuity graph.
// Presents the account's mission as connected context without creating a
// second source of truth. The operating-system tables remain authoritative.

import { query, dbEnabled } from './db.mjs';

const clean = (value, max = 500) => String(value || '').trim().slice(0, max);

export async function getContinuityGraph(userId) {
  if (!userId || !dbEnabled) return null;
  try {
    const [focus, actions, decisions, patterns] = await Promise.all([
      query(`SELECT id, title, description, priority, status FROM mike_focus WHERE user_id = $1 AND status NOT IN ('done','abandoned') ORDER BY updated_at DESC LIMIT 10`, [userId]),
      query(`SELECT id, focus_id, title, status, priority, blocked_by, outcome FROM mike_actions WHERE user_id = $1 AND status NOT IN ('done','abandoned') ORDER BY updated_at DESC LIMIT 20`, [userId]),
      query(`SELECT id, decision, reasoning, outcome, status FROM mike_decisions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 10`, [userId]),
      query(`SELECT id, pattern, confidence, evidence_count FROM mike_patterns WHERE user_id = $1 AND active = true ORDER BY confidence DESC, evidence_count DESC, updated_at DESC LIMIT 10`, [userId]),
    ]);

    const focusRows = focus.rows;
    const actionRows = actions.rows;
    const decisionRows = decisions.rows;
    const patternRows = patterns.rows;

    return {
      priorities: focusRows.filter((x) => x.priority === 'critical' || x.priority === 'high').map((x) => clean(x.title, 240)),
      focus: focusRows.map((x) => ({ id: x.id, title: clean(x.title, 240), description: clean(x.description, 500), priority: x.priority, status: x.status })),
      actions: actionRows.map((x) => ({ id: x.id, focusId: x.focus_id, title: clean(x.title, 300), status: x.status, priority: x.priority, blockedBy: clean(x.blocked_by, 300), outcome: clean(x.outcome, 500) })),
      decisions: decisionRows.map((x) => ({ id: x.id, decision: clean(x.decision, 600), reasoning: clean(x.reasoning, 700), outcome: clean(x.outcome, 500), status: x.status })),
      learnedPatterns: patternRows.map((x) => ({ id: x.id, pattern: clean(x.pattern, 240), confidence: x.confidence, evidenceCount: x.evidence_count })),
    };
  } catch (error) {
    console.error('[continuity-graph] read failed:', error.message || error);
    return null;
  }
}

export function continuityGraphPrompt(graph) {
  if (!graph) return '';
  const lines = [];
  if (graph.priorities?.length) lines.push(`PRIORITIES:\n${graph.priorities.map((x) => `- ${x}`).join('\n')}`);
  if (graph.focus?.length) lines.push(`CURRENT FOCUS:\n${graph.focus.slice(0, 5).map((x) => `- ${x.title} [${x.priority}/${x.status}]${x.description ? ` — ${x.description}` : ''}`).join('\n')}`);
  if (graph.actions?.length) lines.push(`ACTIONS:\n${graph.actions.slice(0, 8).map((x) => `- ${x.title} [${x.priority}/${x.status}]${x.focusId ? ` [focus ${x.focusId}]` : ''}${x.blockedBy ? ` — blocked by ${x.blockedBy}` : ''}`).join('\n')}`);
  if (graph.decisions?.length) lines.push(`RECENT DECISIONS:\n${graph.decisions.slice(0, 5).map((x) => `- ${x.decision}${x.reasoning ? ` — why: ${x.reasoning}` : ''}${x.outcome ? ` — outcome: ${x.outcome}` : ''}`).join('\n')}`);
  if (graph.learnedPatterns?.length) lines.push(`LEARNED WORKING PATTERNS:\n${graph.learnedPatterns.filter((x) => x.evidenceCount >= 2).slice(0, 6).map((x) => `- ${x.pattern} [confidence ${x.confidence}/5, evidence ${x.evidenceCount}]`).join('\n')}`);
  if (!lines.length) return '';
  return `\n\nMIKE CONTINUITY GRAPH\nUse this connected account context to continue relevant work. Treat patterns as hypotheses, not facts. Current user statements override all stored context. Do not mention this internal graph unless asked.\n${lines.join('\n\n')}`;
}
