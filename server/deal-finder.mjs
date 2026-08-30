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
    description:
      'Search the current public web for used items and marketplace listings near a specified location, then rank the strongest buys. Use for requests such as finding a good used vehicle, boat, tool, equipment, appliance, or other item nearby. Never invent listings or prices.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'What the user wants to buy, such as "used Tahoe", "center console boat", or "zero turn mower".' },
        location: { type: 'string', description: 'City/state or ZIP code. Do not guess if no usable location is known.' },
        budget: { type: 'number', description: 'Maximum asking price when the user gave one.' },
        radiusMiles: { type: 'number', description: 'Preferred search radius in miles. If omitted, use a practical local radius.' },
        constraints: { type: 'string', description: 'Other requirements such as year, mileage, hours, condition, title status, or must-have equipment.' },
      },
      required: ['category', 'location'],
      additionalProperties: false,
    },
  },
];

export async function findLocalDeals({ category, location, budget, radiusMiles, constraints } = {}) {
  if (!client) return { error: 'deal_finder_not_configured' };
  const item = String(category || '').trim();
  const place = String(location || '').trim();
  if (!item || !place) return { error: 'category_and_location_required' };

  const budgetText = Number.isFinite(Number(budget)) ? `Maximum asking price: $${Number(budget).toLocaleString('en-US')}.` : 'No maximum price was provided.';
  const radiusText = Number.isFinite(Number(radiusMiles)) ? `Preferred radius: about ${Number(radiusMiles)} miles.` : 'Use a practical local radius and favor nearby listings.';
  const constraintText = String(constraints || '').trim() || 'No additional constraints were provided.';

  const prompt = `You are Mike Deal Finder. Find current public listings for ${item} near ${place}.\n${budgetText}\n${radiusText}\nOther requirements: ${constraintText}\n\nSearch multiple relevant marketplaces and local listing sources when practical. Prefer actual current listings over generic articles. Return up to 8 strong candidates. For each candidate give: title, asking price, approximate location if publicly shown, key details, notable red flags, why it may be a good buy, and the direct listing URL. Rank the best three first. Do not invent or infer missing listing details. If you cannot verify a detail, say it is unknown. If there are not enough credible listings, say so. Keep the response concise enough to read aloud.`;

  try {
    const response = await client.responses.create({
      model: MODEL,
      input: prompt,
      tools: [{ type: 'web_search_preview' }],
    });
    return {
      category: item,
      location: place,
      results: response.output_text?.trim() || 'No credible listings were returned.',
      source: 'OpenAI web search over current public web sources',
    };
  } catch (error) {
    console.error('[deal-finder] search failed:', error.message || error);
    return { error: 'deal_finder_search_failed' };
  }
}

export const DEAL_FINDER_HANDLERS = {
  find_local_deals: findLocalDeals,
};
