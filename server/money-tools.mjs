// Money-focused tools for Mike AI.
// These tools deliberately stay deterministic and local: they structure a
// user's situation without inventing market data. Current pricing/research
// should be delegated to an existing live tool when it is actually needed.

const FREQUENCY_MULTIPLIER = Object.freeze({
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
  one_time: 0,
});

const clean = (value, max = 500) => String(value || '').trim().slice(0, max);

function normalizeAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function monthlyAmount(amount, frequency) {
  if (amount === null) return null;
  const multiplier = FREQUENCY_MULTIPLIER[frequency] ?? 1;
  return Number((amount * multiplier).toFixed(2));
}

function money(value) {
  return value === null ? null : `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Even-derived affordability logic for Mike.
 *
 * It intentionally uses only facts supplied by the user/tool caller. It does
 * not infer bank balances, income, or future transactions. When upcoming
 * expenses are supplied, they are deducted before the purchase decision.
 */
export function purchaseAffordability({ availableCash, purchaseAmount, upcomingExpenses = 0, safetyBuffer = 0 } = {}) {
  const available = normalizeAmount(availableCash);
  const purchase = normalizeAmount(purchaseAmount);
  const upcoming = normalizeAmount(upcomingExpenses) ?? 0;
  const buffer = normalizeAmount(safetyBuffer) ?? 0;

  if (available === null || purchase === null) {
    return {
      tool: 'purchase_affordability',
      status: 'insufficient_information',
      availableCash: available,
      purchaseAmount: purchase,
      upcomingExpenses: upcoming,
      safetyBuffer: buffer,
      remainingAfterPurchase: null,
      spendableAfterUpcomingExpenses: null,
      recommendation: 'I need the available cash and purchase amount before I can calculate whether this is affordable.',
      dataRule: 'Use only user-supplied financial facts. Do not infer balances, income, or future expenses.',
    };
  }

  const spendable = Number((available - upcoming).toFixed(2));
  const remaining = Number((spendable - purchase).toFixed(2));
  const protectedRemaining = Number((remaining - buffer).toFixed(2));

  let status = 'affordable';
  let recommendation = `The purchase leaves ${money(remaining)} after the supplied upcoming expenses.`;

  if (spendable < purchase) {
    status = 'not_affordable';
    recommendation = `I would not make the purchase based on these numbers; you would be ${money(Math.abs(remaining))} short after the supplied upcoming expenses.`;
  } else if (protectedRemaining < 0) {
    status = 'affordable_but_tight';
    recommendation = `You can make the purchase, but it would leave less than your stated ${money(buffer)} safety buffer. I would consider waiting or negotiating the price down.`;
  }

  return {
    tool: 'purchase_affordability',
    status,
    availableCash: available,
    purchaseAmount: purchase,
    upcomingExpenses: upcoming,
    safetyBuffer: buffer,
    spendableAfterUpcomingExpenses: spendable,
    remainingAfterPurchase: remaining,
    protectedRemaining,
    recommendation,
    dataRule: 'Use only user-supplied financial facts. Do not infer balances, income, or future expenses.',
  };
}

export function saveMeMoney({ category = 'purchase', amount, frequency = 'monthly', situation, goal, urgency = 'normal', availableCash, purchaseAmount, upcomingExpenses = 0, safetyBuffer = 0 } = {}) {
  const current = normalizeAmount(amount);
  const freq = Object.prototype.hasOwnProperty.call(FREQUENCY_MULTIPLIER, frequency) ? frequency : 'monthly';
  const monthly = monthlyAmount(current, freq);
  const annual = monthly === null ? null : Number((monthly * 12).toFixed(2));
  const context = clean(situation);
  const target = clean(goal);
  const affordability = (availableCash !== undefined || purchaseAmount !== undefined)
    ? purchaseAffordability({ availableCash, purchaseAmount: purchaseAmount ?? amount, upcomingExpenses, safetyBuffer })
    : null;

  const universalQuestions = [
    'What is the current price or bill, and what exactly does it include?',
    'Is there a lower-cost equivalent that still meets the need?',
    'What fees, add-ons, renewals, or minimum terms are hiding in the total?',
    'What would make the seller/provider lower the price today?',
  ];

  const playbooks = {
    insurance: ['Ask for a re-rate using the same coverage limits.', 'Check deductible changes separately from premium changes.', 'Ask for every available discount before changing coverage.'],
    subscription: ['Identify duplicate or unused features.', 'Ask for a retention offer before cancelling.', 'Check annual pricing and renewal terms.'],
    purchase: ['Compare the all-in price, not the sticker price.', 'Set a target price before negotiating.', 'Use willingness to walk away as leverage.'],
    service: ['Separate labor, materials, trip fees, and warranties.', 'Ask for an itemized quote.', 'Get at least one comparable quote when the amount is material.'],
    utility: ['Ask which plan or rate structure is cheapest for actual usage.', 'Check introductory pricing versus the post-promotion rate.', 'Ask whether equipment or service fees can be removed.'],
    debt: ['Compare APR and total repayment, not just the monthly payment.', 'Ask about fee waivers and rate reductions.', 'Do not extend the term just to make the monthly payment look smaller.'],
  };

  const steps = [...(playbooks[category] || playbooks.purchase), ...universalQuestions].slice(0, 7);
  const targetSavings = monthly === null ? null : Number((monthly * 0.10).toFixed(2));

  return {
    tool: 'save_me_money',
    category: clean(category, 60) || 'purchase',
    currentAmount: current,
    frequency: freq,
    monthlyCost: monthly,
    annualCost: annual,
    initialSavingsTarget: targetSavings,
    initialSavingsTargetDisplay: money(targetSavings),
    urgency: clean(urgency, 30) || 'normal',
    situation: context || null,
    goal: target || null,
    affordability,
    nextSteps: steps,
    recommendedApproach: current === null
      ? 'Get the current all-in price first, then compare alternatives and negotiate from a target rather than a guess.'
      : `Start by targeting about 10% savings (${money(targetSavings)}) and increase the target if there is clear competitive leverage.`,
    negotiationPrompt: 'If the user wants, turn the facts into a short, confident message they can say or send to the seller/provider.',
    dataRule: 'Do not claim a market price, competitor offer, or savings amount as verified unless a live/current-data tool supplied it.',
  };
}

export function secondOpinion({ decision, options = [], priorities = [], concerns = [] } = {}) {
  const choice = clean(decision, 700);
  const opts = Array.isArray(options) ? options.map((v) => clean(v, 250)).filter(Boolean).slice(0, 8) : [];
  const prefs = Array.isArray(priorities) ? priorities.map((v) => clean(v, 120)).filter(Boolean).slice(0, 8) : [];
  const risks = Array.isArray(concerns) ? concerns.map((v) => clean(v, 200)).filter(Boolean).slice(0, 8) : [];
  return {
    tool: 'second_opinion',
    decision: choice || null,
    options: opts,
    priorities: prefs,
    concerns: risks,
    checklist: ['What is the strongest reason to do it?', 'What is the strongest reason not to?', 'What important fact is still unknown?', 'What could make the decision expensive or hard to reverse?', 'What would change the recommendation?'],
    outputFormat: ['best_case', 'downside', 'missing_information', 'recommended_move', 'what_would_change_my_mind'],
  };
}

export function whatAmIMissing({ situation, knownFacts = [], proposedAction } = {}) {
  return {
    tool: 'what_am_i_missing',
    situation: clean(situation, 1000) || null,
    proposedAction: clean(proposedAction, 500) || null,
    knownFacts: Array.isArray(knownFacts) ? knownFacts.map((v) => clean(v, 200)).filter(Boolean).slice(0, 12) : [],
    checks: [
      'Hidden fees, commitments, or renewal terms',
      'A cheaper substitute that meets the same need',
      'Information that would materially change the decision',
      'Negotiation leverage the other side may respond to',
      'Downside risk and the cost of being wrong',
      'A deadline or pressure tactic that should not drive the decision',
    ],
    rule: 'Identify gaps as questions or checks, not as invented facts.',
  };
}

export function getMeABetterDeal({ item, askingPrice, targetPrice, alternatives = [], leverage = [] } = {}) {
  const ask = normalizeAmount(askingPrice);
  const target = normalizeAmount(targetPrice);
  return {
    tool: 'get_me_a_better_deal',
    item: clean(item, 500) || null,
    askingPrice: ask,
    targetPrice: target,
    alternatives: Array.isArray(alternatives) ? alternatives.map((v) => clean(v, 250)).filter(Boolean).slice(0, 8) : [],
    leverage: Array.isArray(leverage) ? leverage.map((v) => clean(v, 250)).filter(Boolean).slice(0, 8) : [],
    negotiationPlan: [
      'Establish the all-in price and what is included.',
      'Anchor with a defensible target rather than an arbitrary low number.',
      'Ask for the concession directly and give a reason.',
      'Be willing to trade speed/certainty for price only when it genuinely helps you.',
      'Set a walk-away point before the negotiation gets emotional.',
    ],
    messageTemplate: 'I like it, but based on the numbers I am comfortable at [TARGET]. If you can make that work, I am ready to move forward.',
    dataRule: 'Do not present a target or alternative as market-verified unless current data supports it.',
  };
}

export function advocatePlan({ goal, facts = [], constraints = [], desiredOutcome } = {}) {
  return {
    tool: 'mike_advocate',
    goal: clean(goal, 800) || null,
    desiredOutcome: clean(desiredOutcome, 500) || null,
    facts: Array.isArray(facts) ? facts.map((v) => clean(v, 300)).filter(Boolean).slice(0, 12) : [],
    constraints: Array.isArray(constraints) ? constraints.map((v) => clean(v, 250)).filter(Boolean).slice(0, 12) : [],
    plan: [
      'Clarify the outcome that matters most.',
      'Separate facts from assumptions.',
      'Find leverage and alternatives.',
      'Choose the lowest-risk next action.',
      'Prepare exactly what to say or do next.',
      'Define what result would trigger a different strategy.',
    ],
    approvalRule: 'Mike may prepare and recommend actions, but must not claim to have contacted a third party or completed an external action unless the system actually did it.',
  };
}

export const MONEY_TOOLS = [
  { type: 'function', name: 'save_me_money', description: 'Help the user find a practical way to reduce a bill, purchase price, service cost, subscription, insurance cost, utility, or debt cost. When available cash, purchase amount, upcoming expenses, or a safety buffer are supplied, also calculate whether the purchase is affordable. Never invent current competitor pricing.', parameters: { type: 'object', properties: { category: { type: 'string', description: 'purchase, insurance, subscription, service, utility, debt, or another short category.' }, amount: { type: 'number', description: 'Current dollar amount, if known.' }, frequency: { type: 'string', enum: ['weekly','biweekly','monthly','quarterly','yearly','one_time'], description: 'How often the amount is paid.' }, situation: { type: 'string', description: 'What the user is paying for and the relevant facts.' }, goal: { type: 'string', description: 'What outcome the user wants.' }, urgency: { type: 'string', description: 'How urgent the decision is.' }, availableCash: { type: 'number', description: 'Available cash supplied by the user, before upcoming expenses.' }, purchaseAmount: { type: 'number', description: 'One-time purchase amount to evaluate for affordability. Defaults to amount when omitted.' }, upcomingExpenses: { type: 'number', description: 'Known upcoming expenses that should be reserved before the purchase.' }, safetyBuffer: { type: 'number', description: 'Minimum cash buffer the user wants left after the purchase.' } }, required: [], additionalProperties: false } },
  { type: 'function', name: 'purchase_affordability', description: 'Determine whether a purchase is affordable using only user-supplied available cash, purchase amount, known upcoming expenses, and optional safety buffer. Never infer bank balances, income, or future expenses.', parameters: { type: 'object', properties: { availableCash: { type: 'number' }, purchaseAmount: { type: 'number' }, upcomingExpenses: { type: 'number' }, safetyBuffer: { type: 'number' } }, required: ['availableCash', 'purchaseAmount'], additionalProperties: false } },
  { type: 'function', name: 'second_opinion', description: 'Structure a second opinion on an important decision. Surface the strongest upside, downside, missing information, risks, and what would change the recommendation.', parameters: { type: 'object', properties: { decision: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, priorities: { type: 'array', items: { type: 'string' } }, concerns: { type: 'array', items: { type: 'string' } } }, required: ['decision'], additionalProperties: false } },
  { type: 'function', name: 'what_am_i_missing', description: 'Look for important gaps, hidden costs, risks, alternatives, and unanswered questions without inventing facts.', parameters: { type: 'object', properties: { situation: { type: 'string' }, knownFacts: { type: 'array', items: { type: 'string' } }, proposedAction: { type: 'string' } }, required: ['situation'], additionalProperties: false } },
  { type: 'function', name: 'get_me_a_better_deal', description: 'Build a practical negotiation plan and message for getting a better price or terms.', parameters: { type: 'object', properties: { item: { type: 'string' }, askingPrice: { type: 'number' }, targetPrice: { type: 'number' }, alternatives: { type: 'array', items: { type: 'string' } }, leverage: { type: 'array', items: { type: 'string' } } }, required: ['item'], additionalProperties: false } },
  { type: 'function', name: 'mike_advocate', description: 'Build a user-first action plan around a goal, facts, constraints, and desired outcome. It can prepare actions but must not claim external actions happened when they did not.', parameters: { type: 'object', properties: { goal: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } }, constraints: { type: 'array', items: { type: 'string' } }, desiredOutcome: { type: 'string' } }, required: ['goal'], additionalProperties: false } },
];

export const MONEY_TOOL_HANDLERS = {
  save_me_money: saveMeMoney,
  purchase_affordability: purchaseAffordability,
  second_opinion: secondOpinion,
  what_am_i_missing: whatAmIMissing,
  get_me_a_better_deal: getMeABetterDeal,
  mike_advocate: advocatePlan,
};
