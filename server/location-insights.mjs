// ── Location insights ────────────────────────────────────
// Answers one owner question: which areas are people asking Mike about?
//
// WHAT THIS RECORDS: the place string a user typed into a location-taking
// tool, which tool it went to, and when. That is the whole row.
//
// WHAT IT NEVER RECORDS: no user id, no account, no email, no IP address,
// no coordinates, no device location. There is deliberately no way to join
// a row back to a person - the table has no key that could. That is not an
// oversight to be "fixed" later; it is the reason this can ship at all.
//
// STREET ADDRESSES ARE COARSENED, NOT STORED. A destination handed to
// get_directions can be somebody's front door. Street lines are stripped and
// only the first two remaining parts kept, so "1247 Oak St, Holland, MI"
// becomes "Holland, MI" and "Austin, TX, USA" stays "Austin, TX". A value
// that is nothing BUT a street address, and any coordinate pair, is dropped
// entirely rather than stored.
//
// Collection is OFF unless LOCATION_INSIGHTS=1. Shipping this without the
// variable changes nothing about how the app behaves - same disarmed-seam
// pattern as entitlements. Before turning it on, say in the privacy policy
// that place names typed into the assistant are retained in aggregate.
import { query } from './db.mjs';

const ENABLED = String(process.env.LOCATION_INSIGHTS || '').trim() === '1';
export const locationInsightsEnabled = () => ENABLED;

// How long rows live. Aggregate curiosity does not need years of history,
// and a short window is its own privacy control.
const RETAIN_DAYS = Number(process.env.LOCATION_RETAIN_DAYS) > 0
  ? Number(process.env.LOCATION_RETAIN_DAYS)
  : 90;

// Only tools whose argument IS a place. Adding a tool here is a privacy
// decision, not a plumbing one - the argument must be somewhere the user
// asked about, never something they said about themselves.
const PLACE_ARGS = {
  get_weather: ['location'],
  get_forecast: ['location'],
  get_weather_alerts: ['location'],
  get_directions: ['destination', 'origin'],
  find_local_services: ['location'],
};

// Reduce a place to something that names an area, never a doorstep.
export function coarsen(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw || raw.length > 200) return null;
  // A coordinate pair is a precise point. Never stored.
  if (/^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(raw)) return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  // Drop leading street lines, then keep the first two of what remains, so
  // "1247 Oak St, Holland, MI" -> "Holland, MI" while "Austin, TX, USA"
  // keeps the city instead of sliding down to "TX, USA".
  const area = parts.filter((part) => !STREET_LINE.test(part));
  if (!area.length) return null;
  return titleCase(area.slice(0, 2).join(', ')).slice(0, 80);
}

// A part is a street line if it opens with a house number or names a street
// type or unit. These are the pieces that identify a doorstep.
const STREET_LINE = /^\d|\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|hwy|highway|pkwy|apt|apartment|ste|suite|unit|floor|fl)\b\.?$/i;

// Consistent casing so "grand rapids" and "Grand Rapids" group as one place.
// Short all-caps tokens (MI, TX, USA, NW) are already right - leave them.
function titleCase(value) {
  return value.split(' ').map((word) => (
    word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)
      ? word
      : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  )).join(' ');
}

let schemaReady = null;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = query(`
      CREATE TABLE IF NOT EXISTS location_queries (
        id         BIGSERIAL PRIMARY KEY,
        place      TEXT NOT NULL,
        tool       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS location_queries_created_idx
        ON location_queries (created_at DESC);
    `).catch((error) => {
      schemaReady = null; // let a later call retry rather than wedging
      throw error;
    });
  }
  return schemaReady;
}

// Fire-and-forget. A logging failure must never break the tool the user
// actually asked for, so this swallows its own errors and returns nothing.
export async function recordLocationQuery(toolName, args = {}) {
  if (!ENABLED) return;
  const keys = PLACE_ARGS[toolName];
  if (!keys) return;
  try {
    await ensureSchema();
    for (const key of keys) {
      const place = coarsen(args?.[key]);
      if (!place) continue;
      await query('INSERT INTO location_queries (place, tool) VALUES ($1, $2)', [place, toolName]);
    }
    // Cheap opportunistic prune; no scheduler to keep alive.
    if (Math.random() < 0.02) {
      await query(`DELETE FROM location_queries WHERE created_at < now() - ($1 || ' days')::interval`, [String(RETAIN_DAYS)]);
    }
  } catch (error) {
    console.error('[location-insights] record failed:', error?.message || error);
  }
}

// Wrap a handler map so every location-taking tool logs on its way through.
// Returns the map unchanged when disabled, so the wiring costs nothing.
export function withLocationLogging(handlers = {}) {
  if (!ENABLED) return handlers;
  const wrapped = { ...handlers };
  for (const name of Object.keys(PLACE_ARGS)) {
    const original = handlers[name];
    if (typeof original !== 'function') continue;
    wrapped[name] = (args, ...rest) => {
      recordLocationQuery(name, args);           // never awaited
      return original(args, ...rest);
    };
  }
  return wrapped;
}

// Owner-only read. Callers must already have established that the requester
// is the owner; this function does not authorize, it only reports.
export async function getLocationInsights({ days = 30, limit = 25 } = {}) {
  if (!ENABLED) return { configured: false, enabled: false };
  try {
    await ensureSchema();
    const window = `now() - ($1 || ' days')::interval`;
    const [top, totals, byTool] = await Promise.all([
      query(`SELECT place, COUNT(*)::int asks, MAX(created_at) last_asked
             FROM location_queries WHERE created_at >= ${window}
             GROUP BY place ORDER BY asks DESC, last_asked DESC LIMIT $2`, [String(days), limit]),
      query(`SELECT COUNT(*)::int asks, COUNT(DISTINCT place)::int places
             FROM location_queries WHERE created_at >= ${window}`, [String(days)]),
      query(`SELECT tool, COUNT(*)::int asks FROM location_queries
             WHERE created_at >= ${window} GROUP BY tool ORDER BY asks DESC`, [String(days)]),
    ]);
    return {
      configured: true,
      enabled: true,
      days,
      retainDays: RETAIN_DAYS,
      totals: totals.rows[0] || { asks: 0, places: 0 },
      top: top.rows,
      byTool: byTool.rows,
    };
  } catch (error) {
    console.error('[location-insights] read failed:', error?.message || error);
    return { configured: false, enabled: true, error: 'unavailable' };
  }
}
