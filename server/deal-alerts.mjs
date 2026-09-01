import { query, dbEnabled } from './db.mjs';
import { findLocalDeals } from './deal-finder.mjs';

const MAX = 50;
const BATCH_SIZE = Math.max(1, Number(process.env.DEAL_ALERT_BATCH || 3));
const MAX_ACTIVE_PER_USER = Math.max(1, Number(process.env.DEAL_ALERT_MAX_PER_USER || 5));
const DEFAULT_FREQUENCY_MINUTES = 15;
const MAX_CONSECUTIVE_FAILURES = Math.max(1, Number(process.env.DEAL_ALERT_MAX_FAILURES || 5));
const ALLOWED_FREQUENCIES = new Set([5, 15, 30, 60]);
const DEFAULT_RADIUS = Math.max(1, Math.min(100, Number(process.env.DEAL_ALERT_DEFAULT_RADIUS_MILES || 25)));

const clean = (v, n) => String(v ?? '').trim().slice(0, n);

export async function ensureDealAlertSchema() {
  if (!dbEnabled) return false;
  await query(`
    CREATE TABLE IF NOT EXISTS deal_alerts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      budget NUMERIC,
      radius_miles INT,
      constraints TEXT,
      frequency_minutes INT NOT NULL DEFAULT 15,
      enabled BOOLEAN NOT NULL DEFAULT true,
      notified_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_results JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_checked_at TIMESTAMPTZ,
      last_notified_at TIMESTAMPTZ,
      consecutive_failures INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE deal_alerts ADD COLUMN IF NOT EXISTS last_results JSONB NOT NULL DEFAULT '[]'::jsonb;
    CREATE INDEX IF NOT EXISTS deal_alerts_due_idx ON deal_alerts(enabled, last_checked_at);
    CREATE INDEX IF NOT EXISTS deal_alerts_user_idx ON deal_alerts(user_id, enabled, created_at DESC);
  `);
  return true;
}

function normalizeFrequency(value) {
  if (value == null || value === '') return DEFAULT_FREQUENCY_MINUTES;
  const frequency = Number(value);
  if (!Number.isInteger(frequency) || !ALLOWED_FREQUENCIES.has(frequency)) throw new Error('deal_alert_frequency_invalid');
  return frequency;
}

export async function createDealAlert(userId, args = {}) {
  if (!userId || !(await ensureDealAlertSchema())) throw new Error('deal_alerts_not_configured');
  const category = clean(args.category || 'resale opportunities', 180) || 'resale opportunities';
  const location = clean(args.location, 160);
  const constraints = clean(args.constraints, 1400) || null;
  const budget = args.budget == null || args.budget === '' ? null : Number(args.budget);
  const radius = args.radiusMiles == null || args.radiusMiles === '' ? DEFAULT_RADIUS : Number(args.radiusMiles);
  const frequency = normalizeFrequency(args.frequencyMinutes);
  if (!location) throw new Error('deal_alert_location_required');
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100) throw new Error('deal_alert_radius_invalid');
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) throw new Error('deal_alert_budget_invalid');

  const { rows: active } = await query('SELECT count(*)::int AS n FROM deal_alerts WHERE user_id=$1 AND enabled=true', [userId]);
  if (Number(active?.[0]?.n || 0) >= MAX_ACTIVE_PER_USER) throw new Error('deal_alert_limit_reached');

  const { rows } = await query(`
    INSERT INTO deal_alerts (user_id, category, location, budget, radius_miles, constraints, frequency_minutes)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, category, location, budget, Math.round(radius), constraints, frequency]
  );
  return rows[0];
}

export async function listDealAlerts(userId) {
  if (!userId || !(await ensureDealAlertSchema())) return [];
  const { rows } = await query(`
    SELECT id, category, location, budget, radius_miles, constraints, frequency_minutes,
           enabled, last_results, last_checked_at, last_notified_at, consecutive_failures, last_error, created_at
    FROM deal_alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, MAX]);
  return rows;
}

export async function cancelDealAlert(userId, id) {
  if (!userId || !(await ensureDealAlertSchema())) return false;
  const { rowCount } = await query('UPDATE deal_alerts SET enabled=false, updated_at=now() WHERE id=$1 AND user_id=$2 AND enabled=true', [id, userId]);
  return rowCount > 0;
}

function normalizeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return value.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function extractCandidates(result) {
  const text = String(result?.results || '');
  const urls = [...new Set((text.match(/https?:\/\/[^\s)\]>]+/g) || []).map((u) => normalizeUrl(u.replace(/[.,;:]+$/, ''))).filter(Boolean))];
  return urls.slice(0, 20).map((url) => ({ url }));
}

function dealScore(result) {
  const text = String(result?.results || '');
  const match = text.match(/(?:deal\s*score|resale\s*score|score)\s*[:=-]\s*(\d{1,3})\s*(?:\/\s*100)?/i);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
}

async function dueAlerts() {
  if (!(await ensureDealAlertSchema())) return [];
  const { rows } = await query(`
    SELECT a.*, u.email, u.name
    FROM deal_alerts a
    JOIN users u ON u.id=a.user_id
    WHERE a.enabled=true
      AND (a.last_checked_at IS NULL OR a.last_checked_at <= now() - make_interval(mins => a.frequency_minutes))
    ORDER BY a.last_checked_at NULLS FIRST
    LIMIT $1`, [BATCH_SIZE]);
  return rows;
}

async function recordFailure(alert, reason) {
  const failures = Number(alert.consecutive_failures || 0) + 1;
  const disable = failures >= MAX_CONSECUTIVE_FAILURES;
  await query(`UPDATE deal_alerts SET consecutive_failures=$2,last_error=$3,enabled=CASE WHEN $4 THEN false ELSE enabled END,updated_at=now() WHERE id=$1`, [alert.id, failures, clean(reason, 500), disable]);
}

export async function checkDealAlerts() {
  const alerts = await dueAlerts();
  let checked = 0;
  let matched = 0;

  for (const alert of alerts) {
    try {
      await query('UPDATE deal_alerts SET last_checked_at=now(), updated_at=now() WHERE id=$1', [alert.id]);
      const result = await findLocalDeals({
        category: alert.category,
        location: alert.location,
        budget: alert.budget == null ? undefined : Number(alert.budget),
        radiusMiles: alert.radius_miles == null ? DEFAULT_RADIUS : Number(alert.radius_miles),
        constraints: alert.constraints || undefined,
        resaleMode: true,
      });
      checked += 1;
      if (result?.error) { await recordFailure(alert, result.error); continue; }
      const candidates = extractCandidates(result);
      const previous = Array.isArray(alert.notified_urls) ? alert.notified_urls.map(normalizeUrl).filter(Boolean) : [];
      const seen = new Set(previous);
      const fresh = candidates.filter((x) => !seen.has(x.url));
      const score = dealScore(result);
      const stored = [{ checkedAt: new Date().toISOString(), score, ...result }];
      await query('UPDATE deal_alerts SET last_results=$2::jsonb, consecutive_failures=0, last_error=NULL, updated_at=now() WHERE id=$1', [alert.id, JSON.stringify(stored)]);
      if (!fresh.length) continue;
      await query('UPDATE deal_alerts SET notified_urls=$2::jsonb,last_notified_at=now(),updated_at=now() WHERE id=$1', [alert.id, JSON.stringify([...new Set([...previous, ...fresh.map((x) => x.url)])].slice(-200))]);
      matched += 1;
      console.log(`[deal-alerts] alert #${alert.id} found ${fresh.length} new resale candidate(s)${score == null ? '' : ` score=${score}/100`}`);
    } catch (error) {
      console.error(`[deal-alerts] alert #${alert.id} failed:`, error.message || error);
      try { await recordFailure(alert, error.message || 'check_failed'); } catch {}
    }
  }
  return { checked, matched };
}

export function startDealAlertScheduler() {
  const run = async () => {
    try {
      const result = await checkDealAlerts();
      if (result.checked || result.matched) console.log(`[deal-alerts] checked=${result.checked} matched=${result.matched}`);
    } catch (error) {
      console.error('[deal-alerts] scheduler failed:', error.message || error);
    }
  };
  void run();
  const timer = setInterval(run, 30_000);
  timer.unref?.();
  return timer;
}

function toolError(error) {
  const code = error.message || 'deal_alert_unavailable';
  const messages = {
    deal_alert_location_required: 'I need your city or ZIP so I can search around you.',
    deal_alert_frequency_invalid: 'Check interval must be 5, 15, 30, or 60 minutes.',
    deal_alert_radius_invalid: 'Search radius must be between 1 and 100 miles.',
    deal_alert_limit_reached: `You already have ${MAX_ACTIVE_PER_USER} active resale scans.`,
  };
  return { error: code, message: messages[code] || code };
}

export async function setDealAlertTool(userId, args = {}) {
  try {
    const alert = await createDealAlert(userId, args);
    return { tool: 'set_deal_alert', alert, message: `Resale deal scan #${alert.id} is active near ${alert.location}, checking every ${alert.frequency_minutes} minutes within ${alert.radius_miles} miles.` };
  } catch (error) { return toolError(error); }
}

export async function listDealAlertsTool(userId) {
  try { return { tool: 'list_deal_alerts', alerts: await listDealAlerts(userId) }; }
  catch (error) { return toolError(error); }
}

export async function cancelDealAlertTool(userId, args = {}) {
  try {
    const id = Number(args.id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'deal_alert_id_invalid' };
    return { tool: 'cancel_deal_alert', canceled: await cancelDealAlert(userId, id) };
  } catch (error) { return toolError(error); }
}

export const DEAL_ALERT_TOOLS = [
  {
    type: 'function', name: 'set_deal_alert',
    description: 'Create a persistent local resale-deal scan. Search current public listings near the user, evaluate likely buy price versus realistic resale value, fees, repair risk, and travel cost, and surface only credible opportunities. Never invent listings, prices, profit, or resale values. If the user says near me, location must be supplied by the client or user; do not guess.',
    parameters: { type: 'object', properties: {
      category: { type: 'string', description: 'Specific category or "resale opportunities" for a broad scan.' },
      location: { type: 'string', description: 'User city/state or ZIP. Required.' },
      budget: { type: 'number', description: 'Maximum cash purchase price.' },
      radiusMiles: { type: 'number', description: 'Search radius, 1-100 miles. Default 25.' },
      constraints: { type: 'string', description: 'Resale preferences, such as easy-to-move items, minimum profit, avoid broken items, or target categories.' },
      frequencyMinutes: { type: 'integer', enum: [5,15,30,60], description: 'How often to rescan.' },
    }, required: ['location'], additionalProperties: false }
  },
  { type: 'function', name: 'list_deal_alerts', description: 'List the signed-in user\'s resale deal scans and their latest results.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'cancel_deal_alert', description: 'Disable one resale deal scan by id.', parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false } },
];

export function dealAlertHandlerFor(name, userId) {
  if (name === 'set_deal_alert') return (args) => setDealAlertTool(userId, args);
  if (name === 'list_deal_alerts') return () => listDealAlertsTool(userId);
  if (name === 'cancel_deal_alert') return (args) => cancelDealAlertTool(userId, args);
  return null;
}
