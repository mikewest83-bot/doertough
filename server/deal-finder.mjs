import OpenAI from 'openai';

const MODEL = process.env.DEAL_FINDER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.DEAL_FINDER_TIMEOUT_MS || 30000);

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 })
  : null;

export const DEAL_FINDER_TOOLS = [
  {
    type: 'function',
    name: 'find_local_deals',
    description: 'Search the current public web for local listings and identify purchases that may be resold for profit. Use for specific items or a broad "resale opportunities" scan. Never invent listings, prices, resale values, or profit.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Specific item/category or "resale opportunities" for a broad scan.' },
        location: { type: 'string', description: 'City/state or ZIP code. Do not guess if no usable location is known.' },
        budget: { type: 'number', description: 'Maximum purchase price when provided.' },
        radiusMiles: { type: 'number', description: 'Preferred local search radius in miles.' },
        constraints: { type: 'string', description: 'Requirements such as minimum profit, easy transport, condition, title status, or categories to avoid.' },
        resaleMode: { type: 'boolean', description: 'Set true when the goal is buying locally and reselling for profit.' },
      },
      required: ['category', 'location'],
      additionalProperties: false,
    },
  },
];

const RESALE_CATEGORIES = [
  'quality tools and tool sets',
  'lawn equipment and small engines',
  'outdoor power equipment',
  'name-brand electronics and appliances',
  'bicycles and fitness equipment',
  'fishing and boating equipment',
  'automotive parts and accessories',
  'quality furniture and home goods',
  'collectibles and hobby equipment',
];

export async function findLocalDeals({ category, location, budget, radiusMiles, constraints, resaleMode = false } = {}) {
  if (!client) return { error: 'deal_finder_not_configured' };
  const item = String(category || '').trim();
  const place = String(location || '').trim();
  if (!item || !place) return { error: 'category_and_location_required' };

  const broadResale = resaleMode || /^resale opportunities$|^resale$/i.test(item);
  const searchTarget = broadResale
    ? `Find the best current local resale opportunities across these categories: ${RESALE_CATEGORIES.join(', ')}.`
    : `Find current public listings for ${item}.`;
  const budgetText = Number.isFinite(Number(budget)) ? `Maximum purchase price: $${Number(budget).toLocaleString('en-US')}.` : 'No maximum purchase price was provided.';
  const radiusText = Number.isFinite(Number(radiusMiles)) ? `Search within about ${Number(radiusMiles)} miles of ${place}.` : `Favor listings close to ${place}; use a practical local radius.`;
  const constraintText = String(constraints || '').trim() || 'No additional constraints were provided.';

  const prompt = `You are Mike Deal Finder, a local resale-hunting engine.\n${searchTarget}\nLocation: ${place}.\n${budgetText}\n${radiusText}\nOther requirements: ${constraintText}\n\nSearch multiple relevant public marketplaces and local listing sources when practical. Do not bypass logins, anti-bot controls, paywalls, or marketplace restrictions. Do not claim complete coverage of any marketplace.\n\nThe goal is NOT to find something merely cheap. Find items that appear materially underpriced relative to a realistic local resale price. Prefer clean, easy-to-test, easy-to-transport items with strong buyer demand. Penalize missing critical information, obvious damage, title problems, counterfeit risk, high repair cost, bulky/slow inventory, and long driving distance.\n\nFor every candidate that you call a real opportunity, report: item/title, asking price, location, listing date if visible, condition/details, direct listing URL, estimated realistic resale range, estimated gross spread, likely fees/repair/travel costs when relevant, estimated net profit range, ROI estimate, confidence, and the specific reason it may be mispriced. If resale value or a cost cannot be supported by current evidence, mark it unknown instead of guessing.\n\nRank candidates by expected risk-adjusted profit. Return no more than 8 candidates and put the two strongest opportunities first. If there is not enough evidence for a genuine profit opportunity, say that clearly. Never invent a listing, price, resale value, profit, or comparable. Keep the response concise enough for voice.`;

  try {
    const response = await client.responses.create({
      model: MODEL,
      input: prompt,
      tools: [{ type: 'web_search_preview' }],
    });
    return {
      category: item,
      location: place,
      resaleMode: broadResale,
      results: response.output_text?.trim() || 'No credible listings were returned.',
      source: 'OpenAI web search over current public web sources',
    };
  } catch (error) {
    console.error('[deal-finder] search failed:', error.message || error);
    return { error: 'deal_finder_search_failed' };
  }
}

function parseJsonArray(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.opportunities) ? parsed.opportunities : [];
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { const parsed = JSON.parse(match[0]); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
}

export async function findResaleDeals({ location, radiusMiles = 25, categories, maxBuy, minProfit = 300, minRoi = 30, constraints } = {}) {
  if (!client) return { error: 'deal_finder_not_configured' };
  const place = String(location || '').trim();
  if (!place) return { error: 'category_and_location_required' };
  const radius = Math.min(250, Math.max(1, Number(radiusMiles) || 25));
  const categoryText = String(categories || RESALE_CATEGORIES.join(', ')).slice(0, 600);
  const maxBuyText = Number.isFinite(Number(maxBuy)) ? `Maximum purchase price: $${Number(maxBuy).toLocaleString('en-US')}.` : 'No maximum purchase price; prioritize realistic, capital-efficient opportunities.';
  const extra = String(constraints || '').trim().slice(0, 1000) || 'No extra constraints.';
  const prompt = `You are Mike's automated local resale scanner. Search the current public web for listings near ${place}, within roughly ${radius} miles.\nCategories: ${categoryText}.\n${maxBuyText}\nMinimum target net profit: $${Number(minProfit) || 300}.\nMinimum target ROI: ${Number(minRoi) || 30}%.\nExtra rules: ${extra}\n\nDo not bypass logins, robots, anti-bot controls, paywalls, or site restrictions. Do not use or scrape sources that prohibit automated collection. If a marketplace is inaccessible, skip it rather than pretending you searched it.\n\nFind only plausible buy-low/resell-higher opportunities. Use current public listing evidence and current resale/comparable evidence when available. Account for realistic selling fees, repair reserve, travel/pickup cost, and obvious risk. Do not treat an asking price as a completed sale. Do not call an item profitable when the evidence is too weak.\n\nReturn ONLY valid JSON: an array of up to 8 objects. Each object must have exactly these fields: title, category, askingPrice, resaleLow, resaleExpected, estimatedProfit, roiPercent, location, why, redFlags, confidence, url. Use null when a value cannot be supported. estimatedProfit must be a conservative net estimate, not gross spread. roiPercent is estimatedProfit divided by askingPrice times 100. confidence must be high, medium, or low. URLs must be direct public listing URLs when available.\n\nRank by risk-adjusted profit and freshness. Only include opportunities where estimatedProfit >= ${Number(minProfit) || 300} and roiPercent >= ${Number(minRoi) || 30}. Never invent a listing, URL, price, resale value, fee, repair cost, profit, or comparable.`;
  try {
    const response = await client.responses.create({
      model: MODEL,
      input: prompt,
      tools: [{ type: 'web_search_preview' }],
    });
    const text = response.output_text?.trim() || '';
    return {
      location: place,
      opportunities: parseJsonArray(text),
      raw: text,
      source: 'OpenAI web search over current public web sources',
    };
  } catch (error) {
    console.error('[deal-finder] resale scan failed:', error.message || error);
    return { error: 'deal_finder_search_failed' };
  }
}

export const DEAL_FINDER_HANDLERS = {
  find_local_deals: findLocalDeals,
};
