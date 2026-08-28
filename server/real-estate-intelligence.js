const RENTCAST_API_URL = "https://api.rentcast.io/v1";

function requireKey() {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) throw new Error("rentcast_not_configured");
  return key;
}

async function get(path, params) {
  const key = requireKey();
  const url = new URL(`${RENTCAST_API_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Api-Key": key },
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || body?.error || `rentcast_${response.status}`);
  return body;
}

export async function analyzeRealEstate({ address, propertyType, bedrooms, bathrooms, squareFootage, maxRadius = 5, daysOld = 270, compCount = 15 } = {}) {
  if (!address) throw new Error("property_address_required");
  const common = { address, propertyType, bedrooms, bathrooms, squareFootage, maxRadius, daysOld, compCount, lookupSubjectAttributes: true };
  const [value, rent] = await Promise.all([
    get("/avm/value", common),
    get("/avm/rent/long-term", common),
  ]);
  return {
    source: "RentCast",
    property: value.subjectProperty || rent.subjectProperty,
    valuation: { estimate: value.price, low: value.priceRangeLow, high: value.priceRangeHigh, comparables: value.comparables || [] },
    rent: { estimate: rent.rent, low: rent.rentRangeLow, high: rent.rentRangeHigh, comparables: rent.comparables || [] },
  };
}

export const REAL_ESTATE_TOOLS = [{
  type: "function",
  name: "analyze_real_estate",
  description: "Analyze a US property using real-estate market intelligence. Use when the user asks about a home's value, rent potential, comparable properties, or whether a property appears reasonably priced. Present results as estimates, not guarantees.",
  parameters: {
    type: "object",
    properties: {
      address: { type: "string", description: "Full US property address." },
      propertyType: { type: "string", description: "Known property type, if available." },
      bedrooms: { type: "number" },
      bathrooms: { type: "number" },
      squareFootage: { type: "number" },
    },
    required: ["address"],
    additionalProperties: false,
  },
}];

export const REAL_ESTATE_HANDLERS = { analyze_real_estate: analyzeRealEstate };
