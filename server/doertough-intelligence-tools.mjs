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

export async function analyzeMoneyCapability({ capability, input } = {}) {
  return analyzeWithDoerToughMoney(capability, input || {});
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
  },
  {
    type: "function",
    name: "use_doertough_money_intelligence",
    description: "Use the existing Doer Tough Money calculation engine when the user asks for a financial scenario, safe-to-spend calculation, purchase affordability, spending summary/trend, or financial snapshot. This tool uses capability-level calculations only; it does not access Plaid, bank credentials, or the Money database. Use only facts the user has supplied in the conversation or that are already present in the tool input.",
    parameters: {
      type: "object",
      properties: {
        capability: { type: "string", enum: ["safe_to_spend", "purchase_affordability", "spending_summary", "spending_trend", "financial_snapshot"], description: "Money intelligence capability to run." },
        input: { type: "object", description: [
          "Scenario facts, in DOLLARS. SIGN RULE, this matters: spending is POSITIVE and income/deposits are NEGATIVE (Plaid's convention). A $3,000 paycheck is -3000; an $85 grocery run is 85. Getting this backwards silently reports income as spending.",
          "Fields by capability:",
          "safe_to_spend -> accounts, bills, optional windowDays (default 14).",
          "purchase_affordability -> accounts, bills, askingPrice, optional deal.",
          "spending_summary -> transactions.",
          "spending_trend -> currentTransactions, previousTransactions.",
          "financial_snapshot -> accounts, bills, transactions, optional budgets, goals.",
          "Shapes: accounts [{type, availableBalance, currentBalance}]; bills [{name, amount, cadence: WEEKLY|MONTHLY|YEARLY|UNKNOWN, nextDueOn: YYYY-MM-DD, active}]; transactions [{amount, category}]; budgets [{category, monthlyLimit, spent}]; goals [{name, target, current}].",
          "Use only figures the user gave you. Omit a field rather than guessing it: a wrong number is worse than an unknown one."
        ].join(" ") }
      },
      required: ["capability"],
      additionalProperties: false
    }
  }
];

export const DOERTOUGH_INTELLIGENCE_HANDLERS = {
  analyze_purchase_with_dealtough: analyzePurchaseWithDealTough,
  use_doertough_money_intelligence: analyzeMoneyCapability,
};

export { intelligenceStatus };
