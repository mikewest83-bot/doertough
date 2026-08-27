/**
 * Doer Tough intelligence bridge for Mike AI.
 *
 * Capability-level integrations only. Mike does not import/copy DealTough or
 * DoerToughMoney application code, and Mike never receives Plaid credentials
 * or direct database access.
 */

const DEALTOUGH_API_URL = process.env.DEALTOUGH_API_URL?.replace(/\/$/, "");
const DOERTOUGH_MONEY_API_URL = process.env.DOERTOUGH_MONEY_API_URL?.replace(/\/$/, "");

export function intelligenceStatus() {
  return { dealTough: Boolean(DEALTOUGH_API_URL), doerToughMoney: Boolean(DOERTOUGH_MONEY_API_URL) };
}

function requireConfigured(baseUrl, name) {
  if (!baseUrl) throw new Error(`${name}_not_configured`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  return payload;
}

/** Route structured purchase/listing analysis through the existing DealTough engine. */
export async function analyzeWithDealTough(dealInput) {
  requireConfigured(DEALTOUGH_API_URL, "DEALTOUGH_API_URL");
  return postJson(`${DEALTOUGH_API_URL}/api/v1/deals/analyze`, dealInput);
}

/**
 * Adapter for the future capability-level DoerToughMoney service boundary.
 * It is intentionally fail-closed until Money exposes a stable, least-privilege
 * endpoint. Mike must never receive raw Plaid credentials or direct DB access.
 */
export async function analyzeWithDoerToughMoney(capability, input, authToken) {
  requireConfigured(DOERTOUGH_MONEY_API_URL, "DOERTOUGH_MONEY_API_URL");
  if (!capability || typeof capability !== "string") throw new Error("money_capability_required");
  if (!authToken) throw new Error("money_authorization_required");
  return postJson(`${DOERTOUGH_MONEY_API_URL}/api/v1/mike/${encodeURIComponent(capability)}`, input, {
    Authorization: `Bearer ${authToken}`,
  });
}
