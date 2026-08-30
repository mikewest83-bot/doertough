// server/live.mjs
// Live-data tools for Mike AI: weather, news headlines, sports scores,
// stock quotes, navigation, and local-service search.

import Parser from 'rss-parser';
import { DICTIONARY_TOOLS, DICTIONARY_TOOL_HANDLERS } from './dictionary-tools.mjs';
import { CODING_TOOLS, CODING_TOOL_HANDLERS } from './coding-tools.mjs';

const rssParser = new Parser({ timeout: 8000 });

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export async function getWeather({ location } = {}) {
  if (!location) throw new Error('location_required');
  const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`);
  const place = geo?.results?.[0];
  if (!place) return { error: `Could not find a location matching "${location}".` };
  const wx = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`);
  return { location: [place.name, place.admin1, place.country].filter(Boolean).join(', '), temperatureF: wx?.current?.temperature_2m, feelsLikeF: wx?.current?.apparent_temperature, humidityPct: wx?.current?.relative_humidity_2m, windMph: wx?.current?.wind_speed_10m, conditions: weatherCodeToText(wx?.current?.weather_code), asOf: wx?.current?.time };
}

function weatherCodeToText(code) {
  const map = { 0:'clear sky',1:'mostly clear',2:'partly cloudy',3:'overcast',45:'fog',48:'freezing fog',51:'light drizzle',53:'drizzle',55:'heavy drizzle',61:'light rain',63:'rain',65:'heavy rain',71:'light snow',73:'snow',75:'heavy snow',77:'snow grains',80:'rain showers',81:'heavy rain showers',82:'violent rain showers',85:'snow showers',86:'heavy snow showers',95:'thunderstorm',96:'thunderstorm with hail',99:'severe thunderstorm with hail' };
  return map[code] || 'unknown conditions';
}

const NEWS_FEEDS = [
  { source: 'BBC News', url: 'http://feeds.bbci.co.uk/news/rss.xml' },
  { source: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
];

export async function getNews({ topic } = {}) {
  const results = [];
  for (const feed of NEWS_FEEDS) {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      for (const item of parsed.items || []) results.push({ source: feed.source, title: item.title, summary: (item.contentSnippet || '').slice(0, 200), published: item.pubDate });
    } catch (err) { console.error(`[news] ${feed.source} failed:`, err.message || err); }
  }
  const filtered = topic ? results.filter((r) => `${r.title} ${r.summary}`.toLowerCase().includes(String(topic).toLowerCase())) : results;
  return { topic: topic || null, headlines: filtered.slice(0, 8), note: topic && filtered.length === 0 ? `No current headlines matched "${topic}" in today's top stories.` : undefined };
}

const LEAGUE_MAP = { nfl:'football/nfl', nba:'basketball/nba', mlb:'baseball/mlb', nhl:'hockey/nhl', ncaaf:'football/college-football', ncaab:'basketball/mens-college-basketball', mls:'soccer/usa.1', epl:'soccer/eng.1', 'premier league':'soccer/eng.1' };

export async function getSportsScores({ league, team } = {}) {
  const key = String(league || '').toLowerCase().trim();
  const slug = LEAGUE_MAP[key];
  if (!slug) return { error: `Unsupported league "${league}". Supported: ${Object.keys(LEAGUE_MAP).join(', ')}.` };
  const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${slug}/scoreboard`);
  let events = (data?.events || []).map((e) => {
    const comp = e.competitions?.[0];
    const competitors = comp?.competitors || [];
    return { name: e.name, status: comp?.status?.type?.description, startTime: e.date, teams: competitors.map((c) => ({ team: c.team?.displayName, score: c.score, winner: c.winner || false })) };
  });
  if (team) { const needle = String(team).toLowerCase(); events = events.filter((e) => e.teams.some((t) => (t.team || '').toLowerCase().includes(needle))); }
  return { league: key, games: events.slice(0, 10) };
}

async function finnhubQuote(ticker) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const q = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(key)}`);
  if (!q || !Number(q.c)) return null;
  return { symbol: ticker, price: Number(q.c), change: Number(q.d), changePercent: Number(q.dp), open: Number(q.o), high: Number(q.h), low: Number(q.l), previousClose: Number(q.pc), asOf: q.t ? new Date(Number(q.t) * 1000).toISOString() : new Date().toISOString(), source: 'finnhub', note: 'Real-time quote.' };
}

async function stooqQuote(ticker) {
  const res = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(ticker.toLowerCase())}.us&f=sd2t2ohlcv&h&e=csv`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`stooq_${res.status}`);
  const csv = await res.text();
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return null;
  const headers = lines[0].split(',');
  const values = lines[1].split(',');
  const row = Object.fromEntries(headers.map((h, i) => [h.trim(), values[i]]));
  if (!row.Close || row.Close === 'N/D') return null;
  return { symbol: ticker, date: row.Date, time: row.Time, open: row.Open, high: row.High, low: row.Low, close: row.Close, price: Number(row.Close), volume: row.Volume, source: 'stooq', note: 'Delayed quote (~15min), not real-time.' };
}

export async function getStockQuote({ symbol } = {}) {
  if (!symbol) throw new Error('symbol_required');
  const ticker = String(symbol).trim().toUpperCase();
  try { const live = await finnhubQuote(ticker); if (live) return live; } catch (err) { console.error('[stocks] finnhub failed, falling back to stooq:', err.message || err); }
  try { const delayed = await stooqQuote(ticker); if (delayed) return delayed; } catch (err) { console.error('[stocks] stooq failed:', err.message || err); }
  return { error: `Could not find a quote for "${symbol}". Try the ticker symbol (e.g. AAPL).` };
}

export function getDirections({ destination, origin, travelMode = 'driving', navigate = true } = {}) {
  const dest = String(destination || '').trim();
  if (!dest) return { error: 'destination_required' };
  const allowed = new Set(['driving', 'walking', 'bicycling', 'transit', 'two-wheeler']);
  const mode = allowed.has(String(travelMode).toLowerCase()) ? String(travelMode).toLowerCase() : 'driving';
  const params = new URLSearchParams({ api: '1', destination: dest, travelmode: mode });
  if (origin) params.set('origin', String(origin).trim());
  if (navigate !== false) params.set('dir_action', 'navigate');
  return { destination: dest, origin: origin ? String(origin).trim() : 'current location when supported', travelMode: mode, mapsUrl: `https://www.google.com/maps/dir/?${params.toString()}`, note: 'Open the link to launch Google Maps. Turn-by-turn navigation depends on the Maps app/device and destination support.' };
}

export function findLocalServices({ query, location } = {}) {
  const q = String(query || '').trim();
  if (!q) return { error: 'query_required' };
  const search = location ? `${q} near ${String(location).trim()}` : q;
  const params = new URLSearchParams({ api: '1', query: search });
  return { query: search, mapsSearchUrl: `https://www.google.com/maps/search/?${params.toString()}`, note: 'Open the link to see current nearby places, ratings, hours, and directions in Google Maps.' };
}

export const LIVE_TOOLS = [
  { type:'function', name:'get_weather', description:'Get current weather conditions for a city or location.', parameters:{ type:'object', properties:{ location:{ type:'string', description:'City and optionally state/country, e.g. Austin, TX.' } }, required:['location'], additionalProperties:false } },
  { type:'function', name:'get_news', description:'Get current top news headlines, optionally filtered to a topic or keyword.', parameters:{ type:'object', properties:{ topic:{ type:'string', description:'Optional topic or keyword to filter headlines by.' } }, required:[], additionalProperties:false } },
  { type:'function', name:'get_sports_scores', description:'Get current or recent scores/schedule for a sports league, optionally filtered to a team.', parameters:{ type:'object', properties:{ league:{ type:'string', description:'League code: nfl, nba, mlb, nhl, ncaaf, ncaab, mls, epl.' }, team:{ type:'string', description:'Optional team name to filter to.' } }, required:['league'], additionalProperties:false } },
  { type:'function', name:'get_stock_quote', description:'Get a stock quote for a ticker symbol. Real-time when the live provider is available; otherwise the response identifies delayed data.', parameters:{ type:'object', properties:{ symbol:{ type:'string', description:'Stock ticker symbol, e.g. AAPL, TSLA.' } }, required:['symbol'], additionalProperties:false } },
  { type:'function', name:'get_directions', description:'Give the user a one-tap Google Maps route to a destination. Use this when the user asks for directions, navigation, travel time to a place, or how to get somewhere. If origin is omitted, Google Maps can use the current device location when supported.', parameters:{ type:'object', properties:{ destination:{ type:'string', description:'Destination address, place name, or coordinates.' }, origin:{ type:'string', description:'Optional starting address or place. Omit to let Google Maps use current location when supported.' }, travelMode:{ type:'string', enum:['driving','walking','bicycling','transit','two-wheeler'], description:'Travel mode. Defaults to driving.' }, navigate:{ type:'boolean', description:'Whether to request navigation mode. Defaults to true.' } }, required:['destination'], additionalProperties:false } },
  { type:'function', name:'find_local_services', description:'Create a current Google Maps search for nearby businesses or services such as urgent care, mechanics, restaurants, gas stations, hotels, stores, or attractions. Use it when the user asks what is nearby.', parameters:{ type:'object', properties:{ query:{ type:'string', description:'Business or service to find, e.g. urgent care, mechanic, gas station, restaurant.' }, location:{ type:'string', description:'Optional city, address, neighborhood, or other area to search near.' } }, required:['query'], additionalProperties:false } },
  ...DICTIONARY_TOOLS,
  ...CODING_TOOLS,
];

export const LIVE_TOOL_HANDLERS = {
  get_weather: getWeather,
  get_news: getNews,
  get_sports_scores: getSportsScores,
  get_stock_quote: getStockQuote,
  get_directions: getDirections,
  find_local_services: findLocalServices,
  ...DICTIONARY_TOOL_HANDLERS,
  ...CODING_TOOL_HANDLERS,
};
