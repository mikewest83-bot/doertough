import { query, dbEnabled } from './db.mjs';
import { findLocalDeals } from './deal-finder.mjs';

let ready = false;
const MAX = 50;
const BATCH_SIZE = Math.max(1, Number(process.env.DEAL_ALERT_BATCH || 5));
const MAX_ACTIVE_PER_USER = Math.max(1, Number(process.env.DEAL_ALERT_MAX_PER_USER || 10));
const DEFAULT_FREQUENCY_MINUTES = 5;
const MAX_CONSECUTIVE_FAILURES = Math.max(1, Number(process.env.DEAL_ALERT_MAX_FAILURES || 5));
const ALLOWED_FREQUENCIES = new Set([5, 15, 30, 60]);

const clean = (v, n) => String(v ?? '').trim().slice(0, n);

export async function ensureDealAlertSchema() {
  if (!dbEnabled || ready) return dbEnabled;
  await query(`
    CREATE TABLE IF NOT EXISTS deal_alerts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      budget NUMERIC,
      radius_miles INT,
      constraints TEXT,
      frequency_minutes INT NOT NULL DEFAULT 5,
      enabled BOOLEAN NOT NULL DEFAULT true,
      notified_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_checked_at TIMESTAMPTZ,
      last_notified_at TIMESTAMPTZ,
      consecutive_failures INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE deal_alerts ALTER COLUMN frequency_minutes SET DEFAULT 5;
    ALTER TABLE deal_alerts ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
    ALTER TABLE deal_alerts ADD COLUMN IF NOT EXISTS last_error TEXT;
    CREATE INDEX IF NOT EXISTS deal_alerts_due_idx ON deal_alerts(enabled, last_checked_at);
    CREATE INDEX IF NOT EXISTS deal_alerts_user_idx ON deal_alerts(user_id, enabled, created_at DESC);
  `);
  ready = true;
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
  const category = clean(args.category, 180);
  const location = clean(args.location, 120);
  const constraints = clean(args.constraints, 1000) || null;
  const budget = args.budget == null || args.budget === '' ? null : Number(args.budget);
  const radius = args.radiusMiles == null || args.radiusMiles === '' ? null : Number(args.radiusMiles);
  const frequency = normalizeFrequency(args.frequencyMinutes);
  if (!category || !location) throw new Error('deal_alert_category_and_location_required');
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) throw new Error('deal_alert_budget_invalid');
  if (radius !== null && (!Number.isFinite(radius) || radius <= 0 || radius > 500)) throw new Error('deal_alert_radius_invalid');

  const { rows: active } = await query('SELECT count(*)::int AS n FROM deal_alerts WHERE user_id=$1 AND enabled=true', [userId]);
  if (Number(active?.[0]?.n || 0) >= MAX_ACTIVE_PER_USER) throw new Error('deal_alert_limit_reached');

  const { rows } = await query(`
    INSERT INTO deal_alerts (user_id, category, location, budget, radius_miles, constraints, frequency_minutes)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, category, location, budget, radius, constraints, frequency]
  );
  return rows[0];
}

export async function listDealAlerts(userId) {
  if (!userId || !(await ensureDealAlertSchema())) return [];
  const { rows } = await query(`
    SELECT id, category, location, budget, radius_miles, constraints, frequency_minutes,
           enabled, last_checked_at, last_notified_at, consecutive_failures, last_error, created_at
    FROM deal_alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, MAX]);
  return rows;
}

export async function cancelDealAlert(userId, id) {
  if (!userId || !(await ensureDealAlertSchema())) return false;
  const { rowCount } = await query(
    'UPDATE deal_alerts SET enabled=false, updated_at=now() WHERE id=$1 AND user_id=$2 AND enabled=true',
    [id, userId]
  );
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

function extractUrls(text) {
  const found = (String(text || '').match(/https?:\/\/[^\s)\]>]+/g) || [])
    .map((u) => u.replace(/[.,;:]+$/, ''));
  return [...new Set(found.map(normalizeUrl).filter(Boolean))].slice(0, 20);
}

function hasCredibleDeal(result) {
  const text = String(result?.results || '');
  return /https?:\/\//i.test(text) && !/no credible listings were returned|not enough credible listings/i.test(text);
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
  await query(
    `UPDATE deal_alerts
     SET consecutive_failures=$2,
         last_error=$3,
         enabled=CASE WHEN $4 THEN false ELSE enabled END,
         updated_at=now()
     WHERE id=$1`,
    [alert.id, failures, clean(reason, 400), disable]
  );
  if (disable) console.warn(`[deal-alerts] alert #${alert.id} paused after ${failures} failed checks: ${reason}`);
}

function dealScore(result) {
  const text = String(result?.results || '');
  if (!text) return null;
  const match = text.match(/(?:deal\s*score|score)\s*[:=-]\s*(\d{1,3})\s*(?:\/\s*100)?/i);
  if (!match) return null;
  const score = Math.max(0, Math.min(100, Number(match[1])));
  return Number.isFinite(score) ? score : null;
}

function shouldTrack(result) {
  const score = dealScore(result);
  return score == null ? hasCredibleDeal(result) : score >= 60;
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
        radiusMiles: alert.radius_miles == null ? undefined : Number(alert.radius_miles),
        constraints: alert.constraints || undefined
      });
      checked += 1;

      if (result?.error) {
        await recordFailure(alert, String(result.error));
        continue;
      }

      if (Number(alert.consecutive_failures || 0) > 0) {
        await query('UPDATE deal_alerts SET consecutive_failures=0, last_error=NULL, updated_at=now() WHERE id=$1', [alert.id]);
        alert.consecutive_failures = 0;
      }

      if (!shouldTrack(result)) continue;

      const urls = extractUrls(result.results);
      const previous = (Array.isArray(alert.notified_urls) ? alert.notified_urls : [])
        .map(normalizeUrl).filter(Boolean);
      const seen = new Set(previous);
      const fresh = urls.filter((u) => !seen.has(u));
      if (!fresh.length) continue;

      const score = dealScore(result);
      await query(
        'UPDATE deal_alerts SET notified_urls=$2::jsonb, last_notified_at=now(), consecutive_failures=0, last_error=NULL, updated_at=now() WHERE id=$1',
        [alert.id, JSON.stringify([...new Set([...previous, ...fresh])].slice(-100))]
      );
      matched += 1;
      console.log(`[deal-alerts] alert #${alert.id} found ${fresh.length} new match(es)${score == null ? '' : ` (score ${score}/100)`}; email delivery disabled`);
    } catch (error) {
      console.error(`[deal-alerts] alert #${alert.id} failed:`, error.message || error);
      try { await recordFailure(alert, error.message || 'check_failed'); } catch {}
    }
  }
  return { checked, notified: 0, matched };
}

export function startDealAlertScheduler() {
  const run = async () => {
    try {
      const result = await checkDealAlerts();
      if (result.checked || result.matched) console.log(`[deal-alerts] checked=${result.checked} matched=${result.matched} email_delivery=disabled`);
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
  if (code === 'deal_alert_limit_reached') {
    return { error: code, message: `You already have ${MAX_ACTIVE_PER_USER} active deal alerts. Cancel one before adding another.` };
  }
  if (code === 'deal_alert_frequency_invalid') {
    return { error: code, message: 'Check interval must be 5, 15, 30, or 60 minutes.' };
  }
  return { error: code };
}

export async function setDealAlertTool(userId, args = {}) {
  try {
    const alert = await createDealAlert(userId, args);
    return {
      tool: 'set_deal_alert',
      alert,
      message: `Deal alert #${alert.id} set for ${alert.category} near ${alert.location}. I’ll keep checking every ${alert.frequency_minutes} minutes. Email alerts are currently disabled.`
    };
  } catch (error) {
    return toolError(error);
  }
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
  } catch (error) {
    return toolError(error);
  }
}

export const DEAL_ALERT_TOOLS = [
  {
    type:'function',
    name:'set_deal_alert',
    description:`Create a persistent scheduled search for the signed-in user. Mike will keep checking current public listings for a matching deal and track new matches. Email delivery is currently disabled. Each account can have up to ${MAX_ACTIVE_PER_USER} active alerts. Check interval choices are 5, 15, 30, or 60 minutes; default is 5. Never claim an email was sent.`,
    parameters:{type:'object',properties:{category:{type:'string'},location:{type:'string'},budget:{type:'number'},radiusMiles:{type:'number'},constraints:{type:'string'},frequencyMinutes:{type:'integer',enum:[5,15,30,60],description:'Check interval in minutes. Default 5.'}},required:['category','location'],additionalProperties:false}
  },
  {
    type:'function',
    name:'list_deal_alerts',
    description:'List the signed-in user\'s active and inactive scheduled deal searches, including recent checks and failures.',
    parameters:{type:'object',properties:{},additionalProperties:false}
  },
  {
    type:'function',
    name:'cancel_deal_alert',
    description:'Disable one of the signed-in user\'s deal searches by id.',
    parameters:{type:'object',properties:{id:{type:'integer'}},required:['id'],additionalProperties:false}
  },
];

export function dealAlertHandlerFor(name, userId) {
  if (name === 'set_deal_alert') return (args) => setDealAlertTool(userId, args);
  if (name === 'list_deal_alerts') return () => listDealAlertsTool(userId);
  if (name === 'cancel_deal_alert') return (args) => cancelDealAlertTool(userId, args);
  return null;
}