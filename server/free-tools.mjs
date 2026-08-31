// server/free-tools.mjs
// Free/keyless tools for Mike AI.

const TIMEOUT_MS = 9000;
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

const DEALTOUGH_URL = process.env.DEALTOUGH_API_URL || 'https://dealtoughai.com';
// Shared secret for DealTough's market-value route. Unset, no header is sent
// and DealTough falls back to its open behaviour, so either side can deploy
// first without breaking the other.
const DEALTOUGH_TOKEN = String(process.env.DEALTOUGH_SERVICE_TOKEN || '').trim();
const DEAL_CATEGORIES = ['vehicle', 'electronics', 'tools', 'furniture', 'outdoor_equipment'];
const DEAL_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor', 'unknown'];

export async function analyzeDeal({ category, title, askingPrice, condition, location, description, daysListed, comparablePrices } = {}) {
  const cat = String(category || '').toLowerCase().trim();
  if (!DEAL_CATEGORIES.includes(cat)) return { error: `category must be one of: ${DEAL_CATEGORIES.join(', ')}.` };
  if (!title) return { error: 'title_required' };

  const hasAskingPrice = askingPrice !== undefined && askingPrice !== null && askingPrice !== '';
  const price = hasAskingPrice ? Number(askingPrice) : null;
  if (hasAskingPrice && (!Number.isFinite(price) || price <= 0)) return { error: 'askingPrice must be a positive number when supplied.' };

  const comparables = (Array.isArray(comparablePrices) ? comparablePrices : [])
    .map(Number)
    .filter((p) => Number.isFinite(p) && p > 0)
    .map((p) => ({ price: p, source: 'user_supplied' }));
  const cond = DEAL_CONDITIONS.includes(String(condition || '').toLowerCase()) ? String(condition).toLowerCase() : 'unknown';

  // If the user did not provide comparable prices, use DealTough's live
  // market-value pipeline so Mike does not manufacture a valuation. DealTough
  // performs the eBay comparable lookup, relevance filtering, outlier removal,
  // sold/active weighting, and fair-market-value calculation.
  if (!comparables.length) {
    try {
      const res = await fetch(`${DEALTOUGH_URL}/api/v1/market-value`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(DEALTOUGH_TOKEN ? { 'x-dealtough-token': DEALTOUGH_TOKEN } : {}) },
        body: JSON.stringify({
          category: cat,
          title: String(title),
          ...(price !== null ? { askingPrice: price } : {}),
          condition: cond,
          ...(location ? { location: String(location) } : {}),
          ...(description ? { description: String(description) } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const raw = await res.text();
      if (!res.ok) return { error: `DealTough market value unavailable: ${raw.slice(0, 200)}` };
      const market = JSON.parse(raw);
      return {
        mode: 'live_market_value',
        title: market.title,
        category: market.category,
        askingPrice: market.askingPrice,
        fairMarketValue: market.fairMarketValue,
        valuationBasis: market.valuationBasis,
        confidencePercent: market.confidencePercent,
        comparablesUsed: market.comparablesUsed,
        soldComparables: market.soldComparables,
        activeComparables: market.activeComparables,
        assumptions: market.assumptions,
        engineVersion: market.engineVersion,
        note: market.valuationBasis === 'unknown'
          ? 'DealTough could not establish a fair market value from usable comparable listings. Say that plainly and do not invent a number.'
          : 'Live market value supplied by DealTough from its comparable-listing pipeline.',
      };
    } catch (err) {
      console.error('[free-tools] DealTough market value failed:', err.message || err);
      return { error: 'DealTough market value is not answering right now.' };
    }
  }

  if (price === null) return { error: 'askingPrice is required for a full deal score when using user-supplied comparable prices.' };

  const body = {
    category: cat,
    title: String(title),
    askingPrice: price,
    condition: cond,
    comparables,
    ...(location ? { location: String(location) } : {}),
    ...(description ? { description: String(description) } : {}),
    ...(Number.isFinite(Number(daysListed)) ? { daysListed: Number(daysListed) } : {}),
  };
  try {
    const res = await fetch(`${DEALTOUGH_URL}/api/v1/deals/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const raw = await res.text();
    if (!res.ok) return { error: `DealTough rejected that: ${raw.slice(0, 200)}` };
    const report = JSON.parse(raw);
    return { dealScore: report.dealScore, verdict: report.verdict, valuationBasis: report.valuationBasis, fairMarketValue: report.fairMarketValue, trueCost: report.trueCost, openingOffer: report.openingOffer, targetPrice: report.targetPrice, walkAwayPrice: report.walkAwayPrice, confidencePercent: report.confidencePercent, riskLevel: report.riskLevel, reasons: report.reasons, topRisks: report.topRisks, sellerQuestions: report.sellerQuestions, negotiationMessage: report.negotiationMessage, engineVersion: report.engineVersion, comparablesUsed: comparables.length, note: report.valuationBasis === 'unknown' ? 'No comparable prices were supplied, so there is no valuation here. Report the Insufficient Data verdict as-is and do not invent comps.' : undefined };
  } catch (err) { console.error('[free-tools] analyze_deal failed:', err.message || err); return { error: 'DealTough is not answering right now.' }; }
}

const COINGECKO_IDS = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', DOGE: 'dogecoin', XRP: 'ripple', ADA: 'cardano', LTC: 'litecoin', LINK: 'chainlink', AVAX: 'avalanche-2', MATIC: 'matic-network' };
export async function getCryptoPrice({ symbol } = {}) {
  const base = String(symbol || 'BTC').toUpperCase().replace(/[-\/]?USDT?$/, '').trim();
  if (!base) return { error: 'symbol_required' };
  try {
    const data = await fetchJson(`https://api.coinbase.com/v2/prices/${base}-USD/spot`);
    const spot = Number(data?.data?.amount);
    if (!Number.isFinite(spot)) return { error: `Could not get a price for "${symbol}".` };
    const out = { symbol: `${base}-USD`, price: spot, source: 'coinbase', asOf: new Date().toISOString() };
    const geckoId = COINGECKO_IDS[base];
    if (geckoId) { try { const g = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd&include_24hr_change=true`); const change = Number(g?.[geckoId]?.usd_24h_change); if (Number.isFinite(change)) out.change24hPercent = Number(change.toFixed(2)); } catch (err) { console.error('[free-tools] coingecko 24h failed:', err.message || err); } }
    return out;
  } catch (err) { console.error('[free-tools] coinbase spot failed:', err.message || err); return { error: `Could not get a price for "${symbol}". Try a ticker like BTC or ETH.` }; }
}

export async function getCurrentTime({ timezone } = {}) {
  const now = new Date();
  const tz = timezone ? String(timezone) : Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); return { timezone: tz, localTime: fmt.format(now), iso: now.toISOString() }; }
  catch { return { error: `"${timezone}" is not a timezone I recognize. Use an IANA name like America/Chicago.`, iso: now.toISOString() }; }
}

export async function lookUpTopic({ topic } = {}) {
  const query = String(topic || '').trim();
  if (!query) return { error: 'topic_required' };
  const headers = { 'User-Agent': 'MikeAI/1.0 (https://doertoughmikeai.com)' };
  const summarize = async (title) => { const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers }); if (!data?.extract) return null; return { title: data.title, summary: data.extract, url: data?.content_urls?.desktop?.page || null, source: 'Wikipedia', note: 'Reference background, not breaking news. Use the news tool for anything current.' }; };
  try { const direct = await summarize(query.replace(/\s+/g, '_')); if (direct) return direct; } catch {}
  try { const found = await fetchJson(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=1`, { headers }); const hit = found?.pages?.[0]?.key; if (hit) { const viaSearch = await summarize(hit); if (viaSearch) return viaSearch; } } catch (err) { console.error('[free-tools] wikipedia failed:', err.message || err); }
  return { error: `Nothing solid came back for "${topic}". Say you could not confirm it rather than guessing.` };
}

// Lightweight dictionary lookup: pronunciation + definitions without bundling a large dictionary.
export async function lookUpWord({ word } = {}) {
  const query = String(word || '').trim();
  if (!query) return { error: 'word_required' };
  if (!/^[A-Za-z][A-Za-z' -]{0,79}$/.test(query)) return { error: 'word_invalid' };
  try {
    const entries = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
    const entry = entries?.[0];
    if (!entry) return { error: `No dictionary entry found for "${query}".` };
    const phonetics = (entry.phonetics || []).filter((p) => p?.text || p?.audio).slice(0, 5).map((p) => ({ text: p.text || null, audio: p.audio || null }));
    const meanings = (entry.meanings || []).slice(0, 6).map((m) => ({ partOfSpeech: m.partOfSpeech || null, definitions: (m.definitions || []).slice(0, 5).map((d) => ({ definition: d.definition, example: d.example || null })), synonyms: (m.synonyms || []).slice(0, 8), antonyms: (m.antonyms || []).slice(0, 8) }));
    return { word: entry.word || query, phonetic: entry.phonetic || phonetics.find((p) => p.text)?.text || null, phonetics, meanings, source: 'Dictionary API' };
  } catch (err) { console.error('[free-tools] dictionary lookup failed:', err.message || err); return { error: `I couldn't confirm the dictionary entry for "${query}" right now.` }; }
}

export const FREE_TOOLS = [
  { type: 'function', name: 'analyze_deal', description: "Analyze a used-item deal with Mike's DealTough engine. If the user does not supply comparable prices, automatically use DealTough's live market-value pipeline and real comparable listings rather than guessing. Returns fair market value when available, and for a full deal with an asking price plus user-supplied comps it also returns the Deal Score, price ladder, risks and negotiation message.", parameters: { type: 'object', properties: { category: { type: 'string', description: 'One of: vehicle, electronics, tools, furniture, outdoor_equipment.' }, title: { type: 'string', description: 'What the item is, e.g. "2015 Ford F-150 XLT".' }, askingPrice: { type: 'number', description: "The seller's asking price in dollars, if known. Omit it when asking only what the item is worth." }, condition: { type: 'string', description: 'One of: new, like_new, good, fair, poor, unknown.' }, location: { type: 'string', description: 'Where the item is, if known.' }, description: { type: 'string', description: 'The listing text or important details, if the user provided them.' }, daysListed: { type: 'number', description: 'How long it has been listed, if known.' }, comparablePrices: { type: 'array', items: { type: 'number' }, description: 'Prices of comparable listings the USER supplied. Leave empty if none were supplied so DealTough can use its live market-value pipeline.' } }, required: ['category', 'title'], additionalProperties: false } },
  { type: 'function', name: 'get_crypto_price', description: 'Get the current US dollar price of a cryptocurrency, with the 24-hour move where available.', parameters: { type: 'object', properties: { symbol: { type: 'string', description: 'Ticker, e.g. BTC, ETH, SOL. Defaults to BTC.' } }, required: [], additionalProperties: false } },
  { type: 'function', name: 'get_current_time', description: "Get the current date and time. Use this before any answer that depends on today's date - scheduling, day planning, or how long ago something was. Do not guess the date.", parameters: { type: 'object', properties: { timezone: { type: 'string', description: 'IANA timezone name, e.g. America/Chicago. Defaults to the server timezone.' } }, required: [], additionalProperties: false } },
  { type: 'function', name: 'look_up_topic', description: 'Look up factual background on a person, place, company, term, or thing from a reference source. Use it instead of guessing at a fact you are unsure about. Not for breaking news - use the news tool for that.', parameters: { type: 'object', properties: { topic: { type: 'string', description: 'What to look up.' } }, required: ['topic'], additionalProperties: false } },
  { type: 'function', name: 'look_up_word', description: 'Look up an English word for pronunciation, definitions, part of speech, examples, synonyms, and antonyms. Use this when the exact meaning or pronunciation matters instead of guessing.', parameters: { type: 'object', properties: { word: { type: 'string', description: 'The English word or short phrase to look up.' } }, required: ['word'], additionalProperties: false } },
];

export const FREE_TOOL_HANDLERS = { analyze_deal: analyzeDeal, get_crypto_price: getCryptoPrice, get_current_time: getCurrentTime, look_up_topic: lookUpTopic, look_up_word: lookUpWord };