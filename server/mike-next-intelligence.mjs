// Mike's next intelligence layer: explicit memory, negotiation coaching, and purchase scoring.
// Deliberately deterministic. No hidden financial data, no invented market facts,
// and no external actions are claimed unless another system actually performs them.

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const amount = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const list = (value, max = 12, itemMax = 300) => Array.isArray(value)
  ? value.map((v) => clean(v, itemMax)).filter(Boolean).slice(0, max)
  : [];

export function rememberPreference({ key, value, category = 'preference' } = {}) {
  const safeKey = clean(key, 120);
  const safeValue = clean(value, 500);
  if (!safeKey || !safeValue) return { tool: 'remember_preference', status: 'insufficient_information' };
  return {
    tool: 'remember_preference',
    status: 'ready_to_save',
    category: clean(category, 60) || 'preference',
    key: safeKey,
    value: safeValue,
    consentRule: 'Only save information when the user explicitly asks Mike to remember it.',
  };
}

export function forgetPreference({ key } = {}) {
  const safeKey = clean(key, 120);
  return {
    tool: 'forget_preference',
    status: safeKey ? 'ready_to_forget' : 'insufficient_information',
    key: safeKey || null,
    consentRule: 'Only remove the requested memory. Never infer other memories to delete.',
  };
}

export function negotiationCoach({ item, askingPrice, targetPrice, facts = [], leverage = [], walkAwayPrice } = {}) {
  const ask = amount(askingPrice);
  const target = amount(targetPrice);
  const walkAway = amount(walkAwayPrice);
  const opening = target === null ? null : Number((target * 0.95).toFixed(2));
  return {
    tool: 'negotiation_coach',
    item: clean(item, 500) || null,
    askingPrice: ask,
    targetPrice: target,
    walkAwayPrice: walkAway,
    facts: list(facts),
    leverage: list(leverage),
    suggestedOpening: opening,
    steps: [
      'Confirm the all-in price and what is included.',
      'Lead with facts rather than emotion.',
      'Make one clear, defensible offer.',
      'Ask what they can do to earn the business today.',
      'Do not reveal your walk-away number unless it helps the negotiation.',
      'If the numbers do not work, be prepared to walk away.',
    ],
    roleplay: 'Mike can role-play the seller/provider and let the user practice responses.',
    dataRule: 'Negotiation targets are user inputs or calculations from user inputs. Do not present them as verified market prices.',
  };
}

export function purchaseScore({ askingPrice, targetPrice, availableCash, upcomingExpenses = 0, safetyBuffer = 0, valueScore, riskScore, dealScore } = {}) {
  const ask = amount(askingPrice);
  const target = amount(targetPrice);
  const cash = amount(availableCash);
  const upcoming = amount(upcomingExpenses) ?? 0;
  const buffer = amount(safetyBuffer) ?? 0;
  const value = amount(valueScore);
  const risk = amount(riskScore);
  const deal = amount(dealScore);
  let affordability = null;
  if (cash !== null && ask !== null) {
    const remaining = Number((cash - upcoming - ask).toFixed(2));
    affordability = {
      remainingAfterPurchase: remaining,
      protectedRemaining: Number((remaining - buffer).toFixed(2)),
      status: remaining < 0 ? 'not_affordable' : (remaining - buffer < 0 ? 'affordable_but_tight' : 'affordable'),
    };
  }
  const targetGap = ask !== null && target !== null ? Number((ask - target).toFixed(2)) : null;
  const components = [value, risk !== null ? 100 - risk : null, deal].filter((v) => v !== null);
  const score = components.length ? Math.round(components.reduce((a, b) => a + b, 0) / components.length) : null;
  return {
    tool: 'purchase_score',
    score,
    scoreMeaning: 'A structured decision aid, not a guarantee or financial recommendation.',
    askingPrice: ask,
    targetPrice: target,
    targetGap,
    affordability,
    components: { valueScore: value, riskScore: risk, dealScore: deal },
    recommendation: affordability?.status === 'not_affordable'
      ? 'The numbers say stop and reassess before buying.'
      : affordability?.status === 'affordable_but_tight'
        ? 'You may be able to buy it, but negotiate harder or wait if possible.'
        : score === null
          ? 'Give Mike a little more information and he can score the decision.'
          : score >= 80
            ? 'Strong candidate, assuming the underlying facts are accurate.'
            : score >= 60
              ? 'Worth a closer look before committing.'
              : 'Proceed cautiously and identify what would improve the deal.',
    dataRule: 'Never manufacture a score from missing facts. Missing components remain null.',
  };
}

export const NEXT_INTELLIGENCE_TOOLS = [
  { type: 'function', name: 'remember_preference', description: 'Prepare an explicit user-requested preference or fact to be saved for future conversations. Never save memory unless the user clearly asks Mike to remember it.', parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, category: { type: 'string' } }, required: ['key', 'value'], additionalProperties: false } },
  { type: 'function', name: 'forget_preference', description: 'Prepare an explicit user-requested memory for removal.', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false } },
  { type: 'function', name: 'negotiation_coach', description: 'Coach the user through a negotiation and optionally role-play the other side. Never claim market pricing is verified unless a live-data tool provided it.', parameters: { type: 'object', properties: { item: { type: 'string' }, askingPrice: { type: 'number' }, targetPrice: { type: 'number' }, walkAwayPrice: { type: 'number' }, facts: { type: 'array', items: { type: 'string' } }, leverage: { type: 'array', items: { type: 'string' } } }, required: ['item'], additionalProperties: false } },
  { type: 'function', name: 'purchase_score', description: 'Create a transparent purchase decision score from supplied value, risk, deal, price, and affordability facts. Missing inputs stay missing.', parameters: { type: 'object', properties: { askingPrice: { type: 'number' }, targetPrice: { type: 'number' }, availableCash: { type: 'number' }, upcomingExpenses: { type: 'number' }, safetyBuffer: { type: 'number' }, valueScore: { type: 'number' }, riskScore: { type: 'number' }, dealScore: { type: 'number' } }, required: [], additionalProperties: false } },
];

export const NEXT_INTELLIGENCE_HANDLERS = {
  remember_preference: rememberPreference,
  forget_preference: forgetPreference,
  negotiation_coach: negotiationCoach,
  purchase_score: purchaseScore,
};
