// server/field-tools.mjs
//
// Second pack of no-cost Mike AI tools. Same rule as free-tools.mjs: no paid
// provider and no new API key. The one exception is the market clock, which
// reuses the Alpaca credentials business.mjs already needs - a free endpoint
// on keys that are already there.
//
//   read_listing       fetch a listing page and strip it to text (SSRF-guarded)
//   get_forecast       api.weather.gov multi-day forecast (keyless)
//   get_weather_alerts api.weather.gov active severe-weather alerts (keyless)
//   get_market_clock   Alpaca /v2/clock - is the market open, when does it open
//   get_btc_rsi        Coinbase candles, RSI-14 computed in-process
//   trade_math         pure local computation, no network at all
//
// get_btc_rsi is OWNER-ONLY and reporting-only: it states the indicator, it
// does not produce a signal or tell anyone to trade.

import dns from 'dns/promises';
import net from 'net';

const TIMEOUT_MS = 9000;
const NWS_HEADERS = { 'User-Agent': 'MikeAI/1.0 (https://doertoughmikeai.com)', Accept: 'application/geo+json' };

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// Shared geocoder - same keyless Open-Meteo service live.mjs already uses.
async function geocode(location) {
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
  );
  const place = geo?.results?.[0];
  if (!place) return null;
  return {
    lat: Number(place.latitude).toFixed(4),
    lon: Number(place.longitude).toFixed(4),
    label: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
  };
}

// ===== read_listing =====
//
// This is the one tool that fetches a URL a stranger chose, so it is the one
// that can be pointed at something it shouldn't reach. Guards: https/http
// only, no credentials in the URL, every resolved address checked against the
// private ranges, and redirects refused outright rather than followed to an
// address we never got to check.

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (/^f[cd]/.test(v6)) return true; // unique local
  if (v6.startsWith('fe80')) return true; // link-local
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return false;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export async function readListing({ url } = {}) {
  const raw = String(url || '').trim();
  if (!raw) return { error: 'url_required' };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'That is not a valid URL.' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { error: 'Only http and https links can be read.' };
  }
  if (parsed.username || parsed.password) {
    return { error: 'Links with embedded credentials are not read.' };
  }

  try {
    const addresses = await dns.lookup(parsed.hostname, { all: true });
    if (!addresses.length) return { error: `Could not resolve ${parsed.hostname}.` };
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      console.warn(`[field-tools] blocked private-address fetch: ${parsed.hostname}`);
      return { error: 'That address is not reachable from here.' };
    }
  } catch {
    return { error: `Could not resolve ${parsed.hostname}.` };
  }

  let res;
  try {
    res = await fetch(parsed.toString(), {
      redirect: 'manual',
      headers: { 'User-Agent': 'MikeAI/1.0 (+https://doertoughmikeai.com)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[field-tools] read_listing fetch failed:', err.message || err);
    return { error: 'That page did not respond.' };
  }

  if (res.status >= 300 && res.status < 400) {
    return {
      error: 'That link redirects. Ask for the final URL and try that one.',
      redirectsTo: res.headers.get('location') || null,
    };
  }
  if (!res.ok) {
    return { error: `That page returned ${res.status}. Many marketplaces block automated reads - ask for the details instead.` };
  }

  const type = res.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
    return { error: `That link is ${type.split(';')[0] || 'not a web page'}, not something readable.` };
  }

  const body = (await res.text()).slice(0, 400_000);
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const text = htmlToText(body);

  if (text.length < 80) {
    return { error: 'That page loaded but had no readable text - it is probably rendered by JavaScript. Ask for the details instead.' };
  }

  return {
    url: parsed.toString(),
    title: titleMatch ? htmlToText(titleMatch[1]).slice(0, 200) : null,
    text: text.slice(0, 6000),
    truncated: text.length > 6000,
    note: 'Extracted page text. Read the price and details out of it - do not fill in anything that is not there. Comparable prices are not in this text unless the page listed them.',
  };
}

// ===== get_forecast (api.weather.gov) =====

export async function getForecast({ location, days } = {}) {
  if (!location) return { error: 'location_required' };

  let place;
  try {
    place = await geocode(location);
  } catch (err) {
    console.error('[field-tools] geocode failed:', err.message || err);
    return { error: 'The location lookup is not answering right now.' };
  }
  if (!place) return { error: `Could not find a location matching "${location}".` };

  let points;
  try {
    points = await fetchJson(`https://api.weather.gov/points/${place.lat},${place.lon}`, { headers: NWS_HEADERS });
  } catch (err) {
    console.error('[field-tools] nws points failed:', err.message || err);
    return {
      error: `No National Weather Service forecast for ${place.label} - this source is US-only. Use the current-conditions weather tool instead.`,
    };
  }

  const forecastUrl = points?.properties?.forecast;
  if (!forecastUrl) return { error: `No forecast available for ${place.label}.` };

  let forecast;
  try {
    forecast = await fetchJson(forecastUrl, { headers: NWS_HEADERS });
  } catch (err) {
    console.error('[field-tools] nws forecast failed:', err.message || err);
    return { error: 'The forecast service is not answering right now.' };
  }

  // Periods alternate day/night, so a "day" is two of them.
  const wanted = Math.min(Math.max(Number(days) || 3, 1), 7) * 2;

  return {
    location: place.label,
    periods: (forecast?.properties?.periods || []).slice(0, wanted).map((p) => ({
      name: p.name,
      temperatureF: p.temperature,
      windSpeed: p.windSpeed,
      windDirection: p.windDirection,
      precipitationChancePct: p.probabilityOfPrecipitation?.value ?? null,
      forecast: p.shortForecast,
      detail: p.detailedForecast,
    })),
    source: 'National Weather Service',
  };
}

// ===== get_weather_alerts (api.weather.gov) =====

export async function getWeatherAlerts({ location } = {}) {
  if (!location) return { error: 'location_required' };

  let place;
  try {
    place = await geocode(location);
  } catch (err) {
    console.error('[field-tools] geocode failed:', err.message || err);
    return { error: 'The location lookup is not answering right now.' };
  }
  if (!place) return { error: `Could not find a location matching "${location}".` };

  let data;
  try {
    data = await fetchJson(`https://api.weather.gov/alerts/active?point=${place.lat},${place.lon}`, {
      headers: NWS_HEADERS,
    });
  } catch (err) {
    console.error('[field-tools] nws alerts failed:', err.message || err);
    return { error: 'The alert service is not answering right now. Do not say there are no alerts - say you could not check.' };
  }

  const alerts = (data?.features || []).map((f) => ({
    event: f?.properties?.event,
    severity: f?.properties?.severity,
    urgency: f?.properties?.urgency,
    headline: f?.properties?.headline,
    area: f?.properties?.areaDesc,
    expires: f?.properties?.expires,
    instruction: f?.properties?.instruction || null,
  }));

  return {
    location: place.label,
    alertCount: alerts.length,
    alerts: alerts.slice(0, 5),
    source: 'National Weather Service',
    note: alerts.length
      ? 'Active alerts. Relay the official instruction text as written - do not soften a warning.'
      : `No active NWS alerts for ${place.label} right now.`,
  };
}

// ===== get_market_clock (Alpaca, reuses existing keys) =====

export async function getMarketClock() {
  const key = process.env.ALPACA_KEY || '';
  const secret = process.env.ALPACA_SECRET || '';
  if (!key || !secret) {
    return { error: 'not_configured', note: 'The trading credentials are not set on this server.' };
  }

  const base = String(process.env.PAPER || 'true') !== 'false'
    ? 'https://paper-api.alpaca.markets'
    : 'https://api.alpaca.markets';

  try {
    const clock = await fetchJson(`${base}/v2/clock`, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
    });
    return {
      isOpen: !!clock.is_open,
      currentTime: clock.timestamp,
      nextOpen: clock.next_open,
      nextClose: clock.next_close,
      note: clock.is_open
        ? 'US equity market is open.'
        : 'US equity market is closed. Crypto trades around the clock regardless.',
    };
  } catch (err) {
    console.error('[field-tools] market clock failed:', err.message || err);
    return { error: 'The market clock is not answering right now.' };
  }
}

// ===== get_btc_rsi (Coinbase candles, RSI computed here) =====

// Wilder's smoothing, the same RSI the bot's strategy is built on.
function computeRsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;

  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    loss = (loss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }

  if (loss === 0) return 100;
  const rs = gain / loss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

const RSI_GRANULARITY = { '1h': 3600, '4h': 21600, '1d': 86400 };

export async function getBtcRsi({ symbol, interval } = {}) {
  const product = String(symbol || 'BTC-USD').toUpperCase().replace(/USD$/, 'USD');
  const pair = product.includes('-') ? product : `${product}-USD`;
  const granularity = RSI_GRANULARITY[String(interval || '1h')] || 3600;

  let candles;
  try {
    candles = await fetchJson(
      `https://api.exchange.coinbase.com/products/${encodeURIComponent(pair)}/candles?granularity=${granularity}`,
      { headers: { 'User-Agent': 'MikeAI/1.0' } }
    );
  } catch (err) {
    console.error('[field-tools] coinbase candles failed:', err.message || err);
    return { error: `Could not get candles for ${pair}.` };
  }

  if (!Array.isArray(candles) || candles.length < 20) {
    return { error: `Not enough candle history for ${pair} to compute RSI.` };
  }

  // Coinbase returns [time, low, high, open, close, volume], newest first.
  const closes = candles
    .slice()
    .sort((a, b) => a[0] - b[0])
    .map((c) => Number(c[4]))
    .filter(Number.isFinite);

  const rsi = computeRsi(closes, 14);
  if (rsi === null) return { error: `Not enough clean data for ${pair}.` };

  return {
    symbol: pair,
    interval: String(interval || '1h'),
    rsi14: rsi,
    lastClose: closes[closes.length - 1],
    candlesUsed: closes.length,
    source: 'coinbase',
    note: 'Indicator reading only. This is not a trade signal and not advice - report the number and stop there.',
  };
}

// ===== trade_math (pure local computation) =====

const round = (n, places = 2) => Number(n.toFixed(places));

export async function tradeMath({ calculation, values } = {}) {
  const kind = String(calculation || '').toLowerCase().trim();
  const v = values && typeof values === 'object' ? values : {};
  const num = (name) => {
    const n = Number(v[name]);
    return Number.isFinite(n) ? n : null;
  };
  const missing = (...names) => names.filter((n) => num(n) === null);

  switch (kind) {
    case 'concrete': {
      const gaps = missing('lengthFt', 'widthFt', 'thicknessIn');
      if (gaps.length) return { error: `Need: ${gaps.join(', ')}.` };
      const cubicFt = num('lengthFt') * num('widthFt') * (num('thicknessIn') / 12);
      const yards = cubicFt / 27;
      const waste = num('wastePercent') ?? 10;
      return {
        calculation: 'concrete',
        cubicFeet: round(cubicFt),
        cubicYards: round(yards),
        cubicYardsWithWaste: round(yards * (1 + waste / 100)),
        wastePercent: waste,
        bags60lb: Math.ceil(cubicFt / 0.45),
        bags80lb: Math.ceil(cubicFt / 0.6),
        note: 'Order by the yard for anything over about a yard. Bag counts are for small pours.',
      };
    }
    case 'board_feet': {
      const gaps = missing('thicknessIn', 'widthIn', 'lengthFt');
      if (gaps.length) return { error: `Need: ${gaps.join(', ')}.` };
      const pieces = num('pieces') ?? 1;
      const perPiece = (num('thicknessIn') * num('widthIn') * (num('lengthFt') * 12)) / 144;
      const total = perPiece * pieces;
      const price = num('pricePerBoardFoot');
      return {
        calculation: 'board_feet',
        boardFeetPerPiece: round(perPiece),
        pieces,
        totalBoardFeet: round(total),
        ...(price !== null ? { totalCost: round(total * price) } : {}),
        note: 'Board feet use nominal thickness. Rough-sawn and surfaced stock measure differently.',
      };
    }
    case 'paint': {
      const gaps = missing('wallAreaSqFt');
      if (gaps.length) return { error: `Need: ${gaps.join(', ')}.` };
      const coats = num('coats') ?? 2;
      const coverage = num('coveragePerGallon') ?? 350;
      const gallons = (num('wallAreaSqFt') * coats) / coverage;
      return {
        calculation: 'paint',
        wallAreaSqFt: num('wallAreaSqFt'),
        coats,
        coveragePerGallon: coverage,
        gallonsNeeded: round(gallons),
        gallonsToBuy: Math.ceil(gallons),
        note: 'Bare drywall, raw wood and dark-over-light drink more than the label says.',
      };
    }
    case 'markup_margin': {
      const cost = num('cost');
      if (cost === null) return { error: 'Need: cost.' };
      const markup = num('markupPercent');
      const margin = num('marginPercent');
      if (markup === null && margin === null) {
        return { error: 'Need one of: markupPercent, marginPercent.' };
      }
      if (margin !== null) {
        if (margin >= 100) return { error: 'Margin has to be under 100%.' };
        const price = cost / (1 - margin / 100);
        return {
          calculation: 'markup_margin',
          cost,
          price: round(price),
          profit: round(price - cost),
          marginPercent: margin,
          markupPercent: round(((price - cost) / cost) * 100, 1),
        };
      }
      const price = cost * (1 + markup / 100);
      return {
        calculation: 'markup_margin',
        cost,
        price: round(price),
        profit: round(price - cost),
        markupPercent: markup,
        marginPercent: round(((price - cost) / price) * 100, 1),
        note: 'Markup and margin are not the same number. 50% markup is a 33% margin.',
      };
    }
    case 'job_quote': {
      const gaps = missing('hours', 'hourlyRate');
      if (gaps.length) return { error: `Need: ${gaps.join(', ')}.` };
      const labor = num('hours') * num('hourlyRate');
      const materials = num('materialCost') ?? 0;
      const materialMarkup = num('materialMarkupPercent') ?? 0;
      const markedUpMaterials = materials * (1 + materialMarkup / 100);
      const overhead = num('overheadPercent') ?? 0;
      const subtotal = (labor + markedUpMaterials) * (1 + overhead / 100);
      const profit = num('profitPercent') ?? 0;
      const total = subtotal * (1 + profit / 100);
      return {
        calculation: 'job_quote',
        laborCost: round(labor),
        materialCost: round(materials),
        materialsWithMarkup: round(markedUpMaterials),
        overheadPercent: overhead,
        profitPercent: profit,
        subtotal: round(subtotal),
        quoteTotal: round(total),
        note: 'Estimate only, from the numbers given. It does not include tax, permits, or disposal unless those were in the material cost.',
      };
    }
    default:
      return {
        error: `Unknown calculation "${calculation}".`,
        supported: ['concrete', 'board_feet', 'paint', 'markup_margin', 'job_quote'],
      };
  }
}

// ===== Tool schemas (OpenAI Responses API) =====

export const FIELD_TOOLS = [
  {
    type: 'function',
    name: 'read_listing',
    description:
      'Fetch a web page - usually a for-sale listing - and return its readable text. Use this when someone pastes a link, then feed the price and details into analyze_deal. Many marketplaces block automated reads; if it fails, ask for the details instead of guessing.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full http or https URL to read.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_forecast',
    description:
      'Get a multi-day National Weather Service forecast for a US location. Use this for planning ahead - what the week looks like on a job site. For right-now conditions use the current weather tool. US only.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City and state, e.g. "Austin, TX".' },
        days: { type: 'number', description: 'How many days ahead, 1 to 7. Defaults to 3.' },
      },
      required: ['location'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_weather_alerts',
    description:
      'Check active National Weather Service severe-weather alerts for a US location - warnings, watches, advisories. If the check fails, say you could not check rather than saying there are none.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City and state, e.g. "Austin, TX".' },
      },
      required: ['location'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_market_clock',
    description:
      'Check whether the US stock market is currently open, and when it next opens or closes. Useful for explaining why an equities bot is quiet. Crypto is unaffected by this.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'get_btc_rsi',
    description:
      'Get the current RSI-14 reading for a crypto pair, computed from Coinbase candles. This is the indicator the trading bot watches. Reporting only - state the number, never turn it into a buy or sell recommendation.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Pair or ticker, e.g. BTC-USD, ETH, SOL. Defaults to BTC-USD.' },
        interval: { type: 'string', description: 'Candle interval: 1h, 4h, or 1d. Defaults to 1h.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'trade_math',
    description:
      'Run a trades or shop calculation: concrete yardage, board feet, paint coverage, markup vs margin, or a job quote from hours and materials. Computed exactly - use it instead of doing the arithmetic in your head.',
    parameters: {
      type: 'object',
      properties: {
        calculation: {
          type: 'string',
          description: 'One of: concrete, board_feet, paint, markup_margin, job_quote.',
        },
        values: {
          type: 'object',
          description:
            'Numbers for the calculation. concrete: lengthFt, widthFt, thicknessIn, wastePercent. board_feet: thicknessIn, widthIn, lengthFt, pieces, pricePerBoardFoot. paint: wallAreaSqFt, coats, coveragePerGallon. markup_margin: cost, and one of markupPercent or marginPercent. job_quote: hours, hourlyRate, materialCost, materialMarkupPercent, overheadPercent, profitPercent.',
          additionalProperties: true,
        },
      },
      required: ['calculation', 'values'],
      additionalProperties: false,
    },
  },
];

export const FIELD_TOOL_HANDLERS = {
  read_listing: readListing,
  get_forecast: getForecast,
  get_weather_alerts: getWeatherAlerts,
  get_market_clock: getMarketClock,
  get_btc_rsi: getBtcRsi,
  trade_math: tradeMath,
};
