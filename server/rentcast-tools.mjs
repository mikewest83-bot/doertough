const RENTCAST_API_URL = 'https://api.rentcast.io/v1';
const TIMEOUT_MS = 10000;

function requireKey() {
  if (!process.env.RENTCAST_API_KEY) throw new Error('rentcast_api_key_not_configured');
}

async function rentcastGet(path, params) {
  requireKey();
  const url = new URL(`${RENTCAST_API_URL}${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Api-Key': process.env.RENTCAST_API_KEY },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `rentcast_${response.status}`);
  return payload;
}

export async function analyzeRealEstate({ address, propertyType, bedrooms, bathrooms, squareFootage, maxRadius, daysOld, compCount = 15 } = {}) {
  if (!address || typeof address !== 'string') throw new Error('property_address_required');
  const base = { address, propertyType, bedrooms, bathrooms, squareFootage, maxRadius, daysOld, compCount, lookupSubjectAttributes: true };

  const [valueResult, rentResult] = await Promise.allSettled([
    rentcastGet('/avm/value', base),
    rentcastGet('/avm/rent/long-term', base),
  ]);

  const value = valueResult.status === 'fulfilled' ? valueResult.value : null;
  const rent = rentResult.status === 'fulfilled' ? rentResult.value : null;

  if (!value && !rent) {
    throw new Error('real_estate_analysis_unavailable');
  }

  return {
    source: 'RentCast',
    subjectProperty: value?.subjectProperty || rent?.subjectProperty || null,
    valuation: value ? {
      estimatedValue: value.price ?? null,
      rangeLow: value.priceRangeLow ?? null,
      rangeHigh: value.priceRangeHigh ?? null,
      comparables: value.comparables || [],
    } : null,
    rental: rent ? {
      estimatedMonthlyRent: rent.rent ?? null,
      rangeLow: rent.rentRangeLow ?? null,
      rangeHigh: rent.rentRangeHigh ?? null,
      comparables: rent.comparables || [],
    } : null,
    errors: {
      valuation: valueResult.status === 'rejected' ? String(valueResult.reason?.message || valueResult.reason) : null,
      rental: rentResult.status === 'rejected' ? String(rentResult.reason?.message || rentResult.reason) : null,
    },
    note: 'Market estimates are third-party AVM estimates and should be treated as decision support, not an appraisal.',
  };
}

export const REAL_ESTATE_TOOLS = [
  {
    type: 'function',
    name: 'analyze_real_estate',
    description: 'Analyze a U.S. property using Doer Tough real-estate intelligence. Use when the user asks what a property is worth, whether a home price looks reasonable, what it could rent for, or asks for comparable properties. Do not present the AVM as a formal appraisal.',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Full U.S. property address.' },
        propertyType: { type: 'string', enum: ['Single Family', 'Condo', 'Townhouse', 'Manufactured', 'Multi-Family', 'Apartment', 'Land'] },
        bedrooms: { type: 'number' },
        bathrooms: { type: 'number' },
        squareFootage: { type: 'number' },
        maxRadius: { type: 'number', description: 'Optional comparable search radius in miles.' },
        daysOld: { type: 'number', description: 'Optional maximum comparable age in days.' },
        compCount: { type: 'number', description: 'Optional number of comparable listings, 5-25.' },
      },
      required: ['address'],
      additionalProperties: false,
    },
  },
];

export const REAL_ESTATE_HANDLERS = {
  analyze_real_estate: analyzeRealEstate,
};
