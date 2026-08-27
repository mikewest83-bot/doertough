/**
 * Doer Tough intelligence bridge for Mike AI.
 *
 * This module intentionally exposes capability-level integrations rather than
 * importing or copying DealTough / DoerToughMoney application code into Mike.
 * Keep the user-facing Mike interface unchanged; Mike's server-side tool layer
 * can call these adapters when the user's intent requires them.
 *
 * Environment variables:
 *   DEALTOUGH_API_URL - existing DealTough deployment base URL
 *   DOERTOUGH_MONEY_API_URL - optional future Money service API base URL
 */

const DEALTOUGH_API_URL = process.env.DEALTOUGH_API_URL?.replace(/\/$/, "");
const DOERTOUGH_MONEY_API_URL = process.env.DOERTOUGH_MONEY_API_URL?.replace(/\/$/, "");

export function intelligenceStatus() {
  return {
    dealTough: Boolean(DEALTOUGH_API_URL),
    doerToughMoney: Boolean(DOERTOUGH_MONEY_API_URL),
  };
}

function requireConfigured(baseUrl, name) {
  if (!baseUrl) throw new Error(`${name} is not configured`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

/**
 * Route a structured purchase/listing analysis through the existing DealTough
 * engine. No DealTough business logic is duplicated here.
 */
export async function analyzeWithDealTough(dealInput) {
  requireConfigured(DEALTOUGH_API_URL, "DEALTOUGH_API_URL");
  return postJson(`${DEALTOUGH_API_URL}/api/v1/deals/analyze`, dealInput);
}

/**
 * Adapter for a future capability-level DoerToughMoney service endpoint.
 * This is deliberately fail-closed until the Money service exposes a stable,
 * least-privilege API contract. Mike must never receive raw Plaid credentials
 * or directly access the Money database.
 */
export async function analyzeWithDoerToughMoney(capability, input, authToken) {
  requireConfigured(DOERTOUGH_MONEY_API_URL, "DOERTOUGH_MONEY_API_URL");
  if (!capability || typeof capability !== "string") {
    throw new Error("Money capability is required");
  }
  if (!authToken) {
    throw new Error("Explicit DoerToughMoney authorization is required");
  }

  return postJson(
    `${DOERTOUGH_MONEY_API_URL}/api/v1/mike/${encodeURIComponent(capability)}`,
    input,
    { Authorization: `Bearer ${authToken}` },
  );
}
