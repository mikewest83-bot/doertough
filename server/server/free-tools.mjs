// server/free-tools.mjs
//
// Mike AI tools that cost nothing to run - no paid provider, no new API key,
// no per-call billing. Each one is either a public keyless endpoint or one of
// Mike's own services.
//
//   analyze_deal      DealTough's own unauthenticated /api/v1/deals/analyze
//   get_crypto_price  Coinbase spot price, CoinGecko for the 24h move
//   get_current_time  computed locally, no network call at all
//   look_up_topic     Wikipedia REST API (keyless)
//
// Nothing here reads private business data, so all of it is safe for public
// visitors as well as for Mike. Handlers return { error } objects rather than
// throwing wherever the failure is expected, so a dead upstream degrades into
// "that isn't answering right now" instead of a broken turn.

const TIMEOUT_MS = 9000;

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// ===== analyze_deal (DealTough engine) =====

const DEALTOUGH_URL = process.env.DEALTOUGH_API_URL || 'https://dealtoughai.com';
const DEAL_CATEGORIES = ['vehicle', 'electronics', 'tools', 'furniture', 'outdoor_equipment'];
const DEAL_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor', 'unknown'];

// Only prices the user actually supplied become comparables. The engine
// reports "Insufficient Data" honestly when there are none, and that verdict
// is passed straight through rather than being smoothed over.
export async function analyzeDeal({
  category,
  title,
  askingPrice,
  condition,
  location,
  description,
  daysListed,
  comparablePrices,
} = {}) {
  const cat = String(category || '').toLowerCase().trim();
  if (!DEAL_CATEGORIES.includes(cat)) {
    return { error: `category must be one of: ${DEAL_CATEGORIES.join(', ')}.` };
  }
  if (!title) return { error: 'title_required' };

  const price = Number(askingPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: 'askingPrice must be a positive number.' };
  }

  const comparables = (Array.isArray(comparablePrices) ? comparablePrices : [])
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p > 0)
    .map((p) => ({ price: p, source: 'user_supplied' }));

  const cond = DEAL_CONDITIONS.includes(String(condition || '').toLowerCase())
    ? String(condition).toLowerCase()
    : 'unknown';

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

  let report;
  try {
    const res = await fetch(`${DEALTOUGH_URL}/api/v1/deals/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.text();
    if (!res.ok) {
      return { error: `DealTough rejected that: ${raw.slice(0, 200)}` };
    }
    report = JSON.parse(raw);
  } catch (err) {
    console.error('[free-tools] analyze_deal failed:', err.message || err);
    return { error: 'DealTough is not answering right now.' };
  }

  return {
    dealScore: report.dealScore,
    verdict: report.verdict,
    valuationBasis: report.valuationBasis,
    fairMarketValue: report.fairMarketValue,
    trueCost: report.trueCost,
    openingOffer: report.openingOffer,
    targetPrice: report.targetPrice,
    walkAwayPrice: report.walkAwayPrice,
    confidencePercent: report.confidencePercent,
    riskLevel: report.riskLevel,
    reasons: report.reasons,
    topRisks: report.topRisks,
    sellerQuestions: report.sellerQuestions,
    negotiationMessage: report.negotiationMessage,
    engineVersion: report.engineVersion,
    comparablesUsed: comparables.length,
    note:
      report.valuationBasis === 'unknown'
        ? 'No comparable prices were supplied, so there is no valuation here. Report the Insufficient Data verdict as-is and do not invent comps.'
        : undefined,
  };
}

// ===== get_crypto_price (Coinbase spot + CoinGecko 24h) =====

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  DOGE: 'dogecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  LTC: 'litecoin',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
};

export async function getCryptoPrice({ symbol } = {}) {
  const base = String(symbol || 'BTC')
    .toUpperCase()
    .replace(/[-/]?USDT?$/, '')
    .trim();
  if (!base) return { error: 'symbol_required' };

  let spot;
  try {
    const data = await fetchJson(`https://api.coinbase.com/v2/prices/${base}-USD/spot`);
    spot = Number(data?.data?.amount);
  } catch (err) {
    console.error('[free-tools] coinbase spot failed:', err.message || err);
    return { error: `Could not get a price for "${symbol}". Try a ticker like BTC or ETH.` };
  }
  if (!Number.isFinite(spot)) {
    return { error: `Could not get a price for "${symbol}".` };
  }

  const out = { symbol: `${base}-USD`, price: spot, source: 'coinbase', asOf: new Date().toISOString() };

  const geckoId = COINGECKO_IDS[base];
  if (geckoId) {
    try {
      const g = await fetchJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd&include_24hr_change=true`
      );
      const change = Number(g?.[geckoId]?.usd_24h_change);
      if (Number.isFinite(change)) out.change24hPercent = Number(change.toFixed(2));
    } catch (err) {
      console.error('[free-tools] coingecko 24h failed:', err.message || err);
    }
  }

  return out;
}

// ===== get_current_time (local, no network) =====

export async function getCurrentTime({ timezone } = {}) {
  const now = new Date();
  const tz = timezone ? String(timezone) : Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    return { timezone: tz, localTime: fmt.format(now), iso: now.toISOString() };
  } catch {
    return {
      error: `"${timezone}" is not a timezone I recognize. Use an IANA name like America/Chicago.`,
      iso: now.toISOString(),
    };
  }
}

// ===== look_up_topic (Wikipedia REST, keyless) =====

export async function lookUpTopic({ topic } = {}) {
  const query = String(topic || '').trim();
  if (!query) return { error: 'topic_required' };

  const headers = { 'User-Agent': 'MikeAI/1.0 (https://doertoughmikeai.com)' };

  const summarize = async (title) => {
    const data = await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers }
    );
    if (!data?.extract) return null;
    return {
      title: data.title,
      summary: data.extract,
      url: data?.content_urls?.desktop?.page || null,
      source: 'Wikipedia',
      note: 'Reference background, not breaking news. Use the news tool for anything current.',
    };
  };

  try {
    const direct = await summarize(query.replace(/\s+/g, '_'));
    if (direct) return direct;
  } catch {
    // fall through to search
  }

  try {
    const found = await fetchJson(
      `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=1`,
      { headers }
    );
    const hit = found?.pages?.[0]?.key;
    if (hit) {
      const viaSearch = await summarize(hit);
      if (viaSearch) return viaSearch;
    }
  } catch (err) {
    console.error('[free-tools] wikipedia failed:', err.message || err);
  }

  return { error: `Nothing solid came back for "${topic}". Say you could not confirm it rather than guessing.` };
}

// ===== Tool schemas (OpenAI Responses API) =====

export const FREE_TOOLS = [
  {
    type: 'function',
    name: 'analyze_deal',
    description:
      "Score a used-item deal with Mike's own DealTough engine. Returns a 0-100 score, verdict, fair market value, an opening offer / target / walk-away ladder, risks, seller questions and a negotiation message. Only pass comparable prices the user actually gave you - never invent them.",
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'One of: vehicle, electronics, tools, furniture, outdoor_equipment.',
        },
        title: { type: 'string', description: 'What the item is, e.g. "2015 Ford F-150 XLT".' },
        askingPrice: { type: 'number', description: "The seller's asking price in dollars." },
        condition: {
          type: 'string',
          description: 'One of: new, like_new, good, fair, poor, unknown.',
        },
        location: { type: 'string', description: 'Where the item is, if known.' },
        description: { type: 'string', description: 'The listing text, if the user provided it.' },
        daysListed: { type: 'number', description: 'How long it has been listed, if known.' },
        comparablePrices: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Prices of comparable listings the USER supplied. Leave empty if they gave none - the engine will honestly report Insufficient Data.',
        },
      },
      required: ['category', 'title', 'askingPrice'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_crypto_price',
    description: 'Get the current US dollar price of a cryptocurrency, with the 24-hour move where available.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker, e.g. BTC, ETH, SOL. Defaults to BTC.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_current_time',
    description:
      "Get the current date and time. Use this before any answer that depends on today's date - scheduling, day planning, or how long ago something was. Do not guess the date.",
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone name, e.g. America/Chicago. Defaults to the server timezone.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'look_up_topic',
    description:
      'Look up factual background on a person, place, company, term, or thing from a reference source. Use it instead of guessing at a fact you are unsure about. Not for breaking news - use the news tool for that.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What to look up.' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
];

export const FREE_TOOL_HANDLERS = {
  analyze_deal: analyzeDeal,
  get_crypto_price: getCryptoPrice,
  get_current_time: getCurrentTime,
  look_up_topic: lookUpTopic,
};
