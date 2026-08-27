import { analyzeWithDealTough, analyzeWithDoerToughMoney, intelligenceStatus } from "./doertough-intelligence-bridge.js";

function normalizeDealInput(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const comparables = Array.isArray(raw.comparables)
    ? raw.comparables.map((c) => {
        if (typeof c === "number" || typeof c === "string") {
          const price = Number(c);
          return Number.isFinite(price) && price > 0 ? { price } : null;
        }
        if (c && typeof c === "object") {
          const price = Number(c.price);
          return Number.isFinite(price) && price > 0 ? { ...c, price } : null;
        }
        return null;
      }).filter(Boolean)
    : [];
  return { ...raw, comparables };
}

export async function analyzePurchaseWithDealTough(input) {
  return analyzeWithDealTough(normalizeDealInput(input));
}

// Reserved for the future least-privilege Money service boundary. It is not
// registered as a Mike tool until Money exposes a stable endpoint and Mike
// can establish explicit per-user authorization without Plaid access.
export async function analyzeMoneyCapability({ capability, input, authorization } = {}) {
  return analyzeWithDoerToughMoney(capability, input || {}, authorization);
}

export const DOERTOUGH_INTELLIGENCE_TOOLS = [
  {
    type: "function",
    name: "analyze_purchase_with_dealtough",
    description: "Use the existing Doer Tough DealTough engine to analyze a specific for-sale listing or one-time purchase. Use when the user asks whether an item is a good deal, fair market value, deal score, target price, walk-away price, or negotiation guidance. Do not invent market values when DealTough cannot establish a valuation.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["vehicle", "electronics", "tools", "furniture", "outdoor_equipment"], description: "DealTough category." },
        title: { type: "string", description: "Listing/item title." },
        description: { type: "string", description: "Listing description or details." },
        askingPrice: { type: "number", description: "Current asking price in dollars." },
        condition: { type: "string", description: "Known condition." },
        comparables: { type: "array", items: { anyOf: [{ type: "number" }, { type: "string" }, { type: "object" }] }, description: "Known comparable prices or comparable objects when available." }
      },
      required: ["category", "askingPrice"],
      additionalProperties: false
    }
  }
];

export const DOERTOUGH_INTELLIGENCE_HANDLERS = {
  analyze_purchase_with_dealtough: analyzePurchaseWithDealTough,
};

export { intelligenceStatus };
