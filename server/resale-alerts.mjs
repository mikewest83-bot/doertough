import { query, dbEnabled } from './db.mjs';
import { findResaleDeals } from './deal-finder.mjs';
import { sendResaleDealAlert } from './mailer.mjs';

const MAX = 50;
const MAX_ACTIVE = Math.max(1, Number(process.env.RESALE_WATCH_MAX_PER_USER || 5));
const DEFAULT_FREQUENCY = 15;
const MIN_FREQUENCY = 15;
const MAX_FAILURES = Math.max(1, Number(process.env.RESALE_WATCH_MAX_FAILURES || 5));
const BATCH_SIZE = Math.max(1, Number(process.env.RESALE_WATCH_BATCH || 3));
let schemaReady = false;

const clean = (v, n) => String(v ?? '').trim().slice(0, n);
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const positive = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function ensureResaleWatchSchema() {
  if (!dbEnabled) return false;
  if (schemaReady) return true;
  await query(`
    CREATE TABLE IF NOT EXISTS resale_watches (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      location TEXT NOT NULL,
      radius_miles INT NOT NULL DEFAULT 25,
      categories TEXT NOT NULL DEFAULT 'vehicles,boats,tools,outdoor power equipment,electronics',
      max_buy NUMERIC,
      min_profit NUMERIC NOT NULL DEFAULT 300,
      min_roi NUMERIC NOT NULL DEFAULT 30,
      constraints TEXT,
      frequency_minutes INT NOT NULL DEFAULT 15,
      enabled BOOLEAN NOT NULL DEFAULT true,
      seen_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_results JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_checked_at TIMESTAMPTZ,
      last_notified_at TIMESTAMPTZ,
      consecutive_failures INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS radius_miles INT NOT NULL DEFAULT 25;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS categories TEXT NOT NULL DEFAULT 'vehicles,boats,tools,outdoor power equipment,electronics';
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS max_buy NUMERIC;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS min_profit NUMERIC NOT NULL DEFAULT 300;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS min_roi NUMERIC NOT NULL DEFAULT 30;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS constraints TEXT;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS frequency_minutes INT NOT NULL DEFAULT 15;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS seen_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS last_results JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
    ALTER TABLE resale_watches ADD COLUMN IF NOT EXISTS last_error TEXT;
    CREATE INDEX IF NOT EXISTS resale_watches_due_idx ON resale_watches(enabled, last_checked_at);
    CREATE INDEX IF NOT EXISTS resale_watches_user_idx ON resale_watches(user_id, enabled, created_at DESC);
  `);
  schemaReady = true;
  return true;
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

function normalizeOpportunity(item) {
  if (!item || typeof item !== 'object') return null;
  const url = normalizeUrl(item.url);
  const askingPrice = money(item.askingPrice);
  const resaleLow = money(item.resaleLow);
  const resaleExpected = money(item.resaleExpected);
  const estimatedProfit = money(item.estimatedProfit);
  const roi = Number(item.roiPercent);
  const dealScoreRaw = Number(item.dealScore);
  return {
    title: clean(item.title, 220),
    category: clean(item.category, 100),
    askingPrice,
    resaleLow,
    resaleExpected,
    estimatedProfit,
    roiPercent: Number.isFinite(roi) ? Math.max(0, Math.min(1000, roi)) : null,
    dealScore: Number.isFinite(dealScoreRaw) ? Math.max(0, Math.min(100, Math.round(dealScoreRaw))) : null,
    location: clean(item.location, 160),
    why: clean(item.why, 500),
    redFlags: clean(item.redFlags, 500),
    confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'low',
    url,
  };
}

function qualifies(item, watch) {
  const profit = Number(item?.estimatedProfit);
  const roi = Number(item?.roiPercent);
  if (!item?.url || !Number.isFinite(profit) || !Number.isFinite(roi)) return false;
  if (profit < Number(watch.min_profit || 0)) return false;
  if (roi < Number(watch.min_roi || 0)) return false;
  if (watch.max_buy != null && Number.isFinite(Number(watch.max_buy)) && Number(item.askingPrice) > Number(watch.max_buy)) return false;
  return true;
}

export async function createResaleWatch(userId, args = {}) {
  if (!userId || !(await ensureResaleWatchSchema())) throw new Error('resale_watch_not_configured');
  const location = clean(args.location, 160);
  if (!location) throw new Error('resale_watch_location_required');
  const radius = Math.min(250, Math.max(1, Math.round(positive(args.radiusMiles, 25))));
  const categories = clean(args.categories || 'vehicles,boats,tools,outdoor power equipment,electronics', 500);
  const maxBuy = args.maxBuy == null || args.maxBuy === '' ? null : money(args.maxBuy);
  const minProfit = money(args.minProfit) ?? 300;
  const minRoi = Math.min(1000, Math.max(0, Number(args.minRoi ?? 30)));
  const constraints = clean(args.constraints, 1000) || null;
  const frequency = Math.max(MIN_FREQUENCY, Math.round(positive(args.frequencyMinutes, DEFAULT_FREQUENCY)));
  if (maxBuy === null && args.maxBuy != null && args.maxBuy !== '') throw new Error('resale_watch_max_buy_invalid');
  if (!Number.isFinite(minProfit) || minProfit < 0) throw new Error('resale_watch_min_profit_invalid');
  if (!Number.isFinite(minRoi) || minRoi < 0) throw new Error('resale_watch_min_roi_invalid');

  const { rows: active } = await query('SELECT count(*)::int AS n FROM resale_watches WHERE user_id=$1 AND enabled=true', [userId]);
  if (Number(active?.[0]?.n || 0) >= MAX_ACTIVE) throw new Error('resale_watch_limit_reached');

  const { rows } = await query(`
    INSERT INTO resale_watches (user_id, location, radius_miles, categories, max_buy, min_profit, min_roi, constraints, frequency_minutes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [userId, location, radius, categories, maxBuy, minProfit, minRoi, constraints, frequency]
  );
  return rows[0];
}

export async function listResaleWatches(userId) {
  if (!userId || !(await ensureResaleWatchSchema())) return [];
  const { rows } = await query(`
    SELECT id, location, radius_miles, categories, max_buy, min_profit, min_roi, constraints,
           frequency_minutes, enabled, last_results, last_checked_at, last_notified_at,
           consecutive_failures, last_error, created_at
    FROM resale_watches WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, MAX]);
  return rows;
}

export async function cancelResaleWatch(userId, id) {
  if (!userId || !(await ensureResaleWatchSchema())) return false;
  const { rowCount } = await query('UPDATE resale_watches SET enabled=false, updated_at=now() WHERE id=$1 AND user_id=$2 AND enabled=true', [id, userId]);
  return rowCount > 0;
}

async function dueWatches() {
  if (!(await ensureResaleWatchSchema())) return [];
  const { rows } = await query(`
    SELECT w.*, u.email, u.name
    FROM resale_watches w JOIN users u ON u.id=w.user_id
    WHERE w.enabled=true
      AND (w.last_checked_at IS NULL OR w.last_checked_at <= now() - make_interval(mins => w.frequency_minutes))
    ORDER BY w.last_checked_at NULLS FIRST LIMIT $1`, [BATCH_SIZE]);
  return rows;
}

async function recordFailure(watch, reason) {
  const failures = Number(watch.consecutive_failures || 0) + 1;
  const disable = failures >= MAX_FAILURES;
  await query(`UPDATE resale_watches SET consecutive_failures=$2,last_error=$3,enabled=CASE WHEN $4 THEN false ELSE enabled END,updated_at=now() WHERE id=$1`,
    [watch.id, failures, clean(reason, 400), disable]);
  if (disable) console.warn(`[resale-watch] watch #${watch.id} paused after ${failures} failures: ${reason}`);
}

export async function checkResaleWatches() {
  const watches = await dueWatches();
  let checked = 0;
  let matched = 0;
  let emailed = 0;

  for (const watch of watches) {
    try {
      await query('UPDATE resale_watches SET last_checked_at=now(), updated_at=now() WHERE id=$1', [watch.id]);
      const result = await findResaleDeals({
        location: watch.location,
        radiusMiles: Number(watch.radius_miles),
        categories: watch.categories,
        maxBuy: watch.max_buy == null ? undefined : Number(watch.max_buy),
        minProfit: Number(watch.min_profit),
        minRoi: Number(watch.min_roi),
        constraints: watch.constraints || undefined,
      });
      checked += 1;
      if (result?.error) { await recordFailure(watch, result.error); continue; }

      const opportunities = (Array.isArray(result.opportunities) ? result.opportunities : [])
        .map(normalizeOpportunity).filter(Boolean).filter((item) => qualifies(item, watch)).slice(0, 8);
      const previous = (Array.isArray(watch.seen_urls) ? watch.seen_urls : []).map(normalizeUrl).filter(Boolean);
      const seen = new Set(previous);
      const fresh = opportunities.filter((item) => !seen.has(item.url));

      await query(`UPDATE resale_watches SET last_results=$2::jsonb, consecutive_failures=0, last_error=NULL, updated_at=now() WHERE id=$1`,
        [watch.id, JSON.stringify(opportunities)]);
      watch.consecutive_failures = 0;
      if (!fresh.length) continue;

      const mergedUrls = [...new Set([...previous, ...fresh.map((item) => item.url)])].slice(-200);
      await query(`UPDATE resale_watches SET seen_urls=$2::jsonb,last_notified_at=now(),updated_at=now() WHERE id=$1`, [watch.id, JSON.stringify(mergedUrls)]);
      matched += fresh.length;

      const mail = await sendResaleDealAlert({
        to: watch.email,
        name: watch.name,
        location: watch.location,
        radiusMiles: watch.radius_miles,
        opportunities: fresh,
      });
      if (mail?.sent) emailed += 1;
      console.log(`[resale-watch] #${watch.id} found=${fresh.length} email_sent=${mail?.sent ? 'true' : 'false'}`);
    } catch (error) {
      console.error(`[resale-watch] #${watch.id} failed:`, error.message || error);
      try { await recordFailure(watch, error.message || 'watch_failed'); } catch {}
    }
  }
  return { checked, matched, emailed };
}

export function startResaleWatchScheduler() {
  const run = async () => {
    try {
      const result = await checkResaleWatches();
      if (result.checked || result.matched) console.log(`[resale-watch] checked=${result.checked} matched=${result.matched} emails=${result.emailed}`);
    } catch (error) {
      console.error('[resale-watch] scheduler failed:', error.message || error);
    }
  };
  void run();
  const timer = setInterval(run, 60_000);
  timer.unref?.();
  return timer;
}

function toolError(error) {
  const code = error.message || 'resale_watch_unavailable';
  if (code === 'resale_watch_limit_reached') return { error: code, message: `You already have ${MAX_ACTIVE} active resale watches.` };
  if (code === 'resale_watch_location_required') return { error: code, message: 'Give me a ZIP code, city/state, or enable location in the app so I know where to scan.' };
  return { error: code };
}

export async function setResaleWatchTool(userId, args = {}) {
  try {
    const watch = await createResaleWatch(userId, args);
    return { tool: 'set_resale_watch', watch, message: `Resale watch #${watch.id} is active. I’ll scan around ${watch.location} within ${watch.radius_miles} miles every ${watch.frequency_minutes} minutes and only alert on opportunities meeting the minimum profit and ROI rules.` };
  } catch (error) { return toolError(error); }
}

export async function listResaleWatchesTool(userId) {
  try { return { tool: 'list_resale_watches', watches: await listResaleWatches(userId) }; }
  catch (error) { return toolError(error); }
}

export async function cancelResaleWatchTool(userId, args = {}) {
  try {
    const id = Number(args.id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'resale_watch_id_invalid' };
    return { tool: 'cancel_resale_watch', canceled: await cancelResaleWatch(userId, id) };
  } catch (error) { return toolError(error); }
}

export const RESALE_ALERT_TOOLS = [
  { type:'function', name:'set_resale_watch', description:'Create a persistent resale-deal scanner for the signed-in user. It searches current public web listings near the specified location, estimates resale value from current comparable listings, calculates expected net profit and ROI, and emails only new opportunities that meet the user’s thresholds. Never claim a deal is guaranteed. Do not automate access to marketplaces that prohibit automated collection or require login; use public sources and user-provided listing links instead.', parameters:{type:'object',properties:{location:{type:'string',description:'ZIP code or city/state. Do not guess.'},radiusMiles:{type:'number',description:'Search radius in miles. Default 25.'},categories:{type:'string',description:'Comma-separated categories. Default vehicles, boats, tools, outdoor power equipment, electronics.'},maxBuy:{type:'number',description:'Maximum purchase price.'},minProfit:{type:'number',description:'Minimum estimated net profit. Default $300.'},minRoi:{type:'number',description:'Minimum estimated ROI percent. Default 30.'},constraints:{type:'string',description:'Extra buying rules.'},frequencyMinutes:{type:'integer',description:'Scan interval. Minimum 15 minutes.'}},required:['location'],additionalProperties:false}},
  { type:'function', name:'list_resale_watches', description:'List the signed-in user’s resale deal scanners and their most recent matching opportunities.', parameters:{type:'object',properties:{},additionalProperties:false}},
  { type:'function', name:'cancel_resale_watch', description:'Disable one resale deal scanner by id.', parameters:{type:'object',properties:{id:{type:'integer'}},required:['id'],additionalProperties:false}},
];

export function resaleAlertHandlerFor(name, userId) {
  if (name === 'set_resale_watch') return (args) => setResaleWatchTool(userId, args);
  if (name === 'list_resale_watches') return () => listResaleWatchesTool(userId);
  if (name === 'cancel_resale_watch') return (args) => cancelResaleWatchTool(userId, args);
  return null;
}
