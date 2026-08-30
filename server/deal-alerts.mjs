import { query, dbEnabled } from './db.mjs';
import { findLocalDeals } from './deal-finder.mjs';
import { sendReminder } from './mailer.mjs';

let ready = false;
const MAX = 50;
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE deal_alerts ALTER COLUMN frequency_minutes SET DEFAULT 5;
    CREATE INDEX IF NOT EXISTS deal_alerts_due_idx ON deal_alerts(enabled, last_checked_at);
    CREATE INDEX IF NOT EXISTS deal_alerts_user_idx ON deal_alerts(user_id, enabled, created_at DESC);
  `);
  ready = true;
  return true;
}

export async function createDealAlert(userId, args = {}) {
  if (!userId || !(await ensureDealAlertSchema())) throw new Error('deal_alerts_not_configured');
  const category = clean(args.category, 180);
  const location = clean(args.location, 120);
  const constraints = clean(args.constraints, 1000) || null;
  const budget = args.budget == null || args.budget === '' ? null : Number(args.budget);
  const radius = args.radiusMiles == null || args.radiusMiles === '' ? null : Number(args.radiusMiles);
  const frequency = Math.min(1440, Math.max(5, Number(args.frequencyMinutes || 5)));
  if (!category || !location) throw new Error('deal_alert_category_and_location_required');
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) throw new Error('deal_alert_budget_invalid');
  if (radius !== null && (!Number.isFinite(radius) || radius <= 0 || radius > 500)) throw new Error('deal_alert_radius_invalid');
  const { rows } = await query(`
    INSERT INTO deal_alerts (user_id, category, location, budget, radius_miles, constraints, frequency_minutes)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, category, location, budget, radius, constraints, frequency]
  );
  return rows[0];
}

export async function listDealAlerts(userId) {
  if (!userId || !(await ensureDealAlertSchema())) return [];
  const { rows } = await query(`SELECT id, category, location, budget, radius_miles, constraints, frequency_minutes, enabled, last_checked_at, last_notified_at, created_at FROM deal_alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, MAX]);
  return rows;
}

export async function cancelDealAlert(userId, id) {
  if (!userId || !(await ensureDealAlertSchema())) return false;
  const { rowCount } = await query('UPDATE deal_alerts SET enabled=false, updated_at=now() WHERE id=$1 AND user_id=$2 AND enabled=true', [id, userId]);
  return rowCount > 0;
}

function extractUrls(text) {
  return [...new Set((String(text || '').match(/https?:\/\/[^\s)\]>]+/g) || []).map((u) => u.replace(/[.,;:]+$/, '')))].slice(0, 20);
}
function hasCredibleDeal(result) {
  const text = String(result?.results || '');
  return /https?:\/\//i.test(text) && !/no credible listings were returned|not enough credible listings/i.test(text);
}
async function dueAlerts() {
  if (!(await ensureDealAlertSchema())) return [];
  const { rows } = await query(`SELECT a.*, u.email, u.name FROM deal_alerts a JOIN users u ON u.id=a.user_id WHERE a.enabled=true AND (a.last_checked_at IS NULL OR a.last_checked_at <= now() - make_interval(mins => a.frequency_minutes)) ORDER BY a.last_checked_at NULLS FIRST LIMIT $1`, [MAX]);
  return rows;
}

export async function checkDealAlerts() {
  const alerts = await dueAlerts();
  let checked = 0;
  let notified = 0;
  for (const alert of alerts) {
    try {
      await query('UPDATE deal_alerts SET last_checked_at=now(), updated_at=now() WHERE id=$1', [alert.id]);
      const result = await findLocalDeals({ category: alert.category, location: alert.location, budget: alert.budget == null ? undefined : Number(alert.budget), radiusMiles: alert.radius_miles == null ? undefined : Number(alert.radius_miles), constraints: alert.constraints || undefined });
      checked += 1;
      if (!hasCredibleDeal(result)) continue;
      const urls = extractUrls(result.results);
      const previous = Array.isArray(alert.notified_urls) ? alert.notified_urls : [];
      const fresh = urls.filter((u) => !previous.includes(u));
      if (!fresh.length) continue;
      const note = `Mike found a new match for your ${alert.category} deal alert near ${alert.location}.\n\n${String(result.results).slice(0, 3500)}\n\nNew listing links:\n${fresh.slice(0, 5).join('\n')}`;
      const mail = await sendReminder({ to: alert.email, name: alert.name, title: `Deal alert: ${alert.category}`, note, remindAt: new Date() });
      if (mail.sent) {
        await query('UPDATE deal_alerts SET notified_urls=$2::jsonb, last_notified_at=now(), updated_at=now() WHERE id=$1', [alert.id, JSON.stringify([...new Set([...previous, ...fresh])].slice(-100))]);
        notified += 1;
      }
    } catch (error) {
      console.error(`[deal-alerts] alert #${alert.id} failed:`, error.message || error);
    }
  }
  return { checked, notified };
}

export function startDealAlertScheduler() {
  const run = async () => {
    try {
      const result = await checkDealAlerts();
      if (result.checked || result.notified) console.log(`[deal-alerts] checked=${result.checked} notified=${result.notified}`);
    } catch (error) { console.error('[deal-alerts] scheduler failed:', error.message || error); }
  };
  void run();
  const timer = setInterval(run, 30_000);
  timer.unref?.();
  return timer;
}

function toolError(error) { return { error: error.message || 'deal_alert_unavailable' }; }
export async function setDealAlertTool(userId, args = {}) {
  try { const alert = await createDealAlert(userId, args); return { tool: 'set_deal_alert', alert, message: `Deal alert set for ${alert.category} near ${alert.location}. I’ll check every ${alert.frequency_minutes} minutes and notify you when I find a new matching listing.` }; }
  catch (error) { return toolError(error); }
}
export async function listDealAlertsTool(userId) { try { return { tool: 'list_deal_alerts', alerts: await listDealAlerts(userId) }; } catch (error) { return toolError(error); } }
export async function cancelDealAlertTool(userId, args = {}) { try { const id = Number(args.id); if (!Number.isInteger(id) || id <= 0) return { error: 'deal_alert_id_invalid' }; return { tool: 'cancel_deal_alert', canceled: await cancelDealAlert(userId, id) }; } catch (error) { return toolError(error); } }

export const DEAL_ALERT_TOOLS = [
  { type:'function', name:'set_deal_alert', description:'Create a persistent alert that searches current public listings for the signed-in user and emails them when a new matching deal is found. Use when the user wants Mike to keep looking for a specific item or bargain. Never claim an alert was set unless this succeeds.', parameters:{type:'object',properties:{category:{type:'string'},location:{type:'string'},budget:{type:'number'},radiusMiles:{type:'number'},constraints:{type:'string'},frequencyMinutes:{type:'integer',description:'Check interval in minutes. Allowed values: 5, 15, 30, or 60; default 5.'}},required:['category','location'],additionalProperties:false}},
  { type:'function', name:'list_deal_alerts', description:'List the signed-in user\'s active and inactive deal alerts.', parameters:{type:'object',properties:{},additionalProperties:false}},
  { type:'function', name:'cancel_deal_alert', description:'Disable one of the signed-in user\'s deal alerts by id.', parameters:{type:'object',properties:{id:{type:'integer'}},required:['id'],additionalProperties:false}},
];
export function dealAlertHandlerFor(name, userId) {
  if (name === 'set_deal_alert') return (args) => setDealAlertTool(userId, args);
  if (name === 'list_deal_alerts') return () => listDealAlertsTool(userId);
  if (name === 'cancel_deal_alert') return (args) => cancelDealAlertTool(userId, args);
  return null;
}
