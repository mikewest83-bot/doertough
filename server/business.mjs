// server/business.mjs
//
// Doer Tough business tools for Mike AI: store sales (Shopify Admin API)
// and trading bot status (Alpaca). Both degrade gracefully - if credentials
// aren't set, the tool returns a plain note instead of throwing, so Mike
// says "that isn't wired up yet" rather than erroring out mid-answer.
//
// Shopify auth note: as of Jan 1 2026 Shopify no longer issues permanent
// shpat_ tokens. Dev Dashboard apps get a client ID + secret, which are
// exchanged for a short-lived token via the client credentials grant.
// The token endpoint expects a FORM-ENCODED body, not JSON, and returns
// non-JSON error text on failure - both handled below.
//
// Env:
//   SHOPIFY_STORE_DOMAIN    default sae061-ws.myshopify.com
//   SHOPIFY_CLIENT_ID       Dev Dashboard app client ID
//   SHOPIFY_CLIENT_SECRET   Dev Dashboard app client secret (shpss_...)
//   SHOPIFY_ADMIN_TOKEN     optional legacy shpat_ token; overrides the above
//   SHOPIFY_API_VERSION     default 2026-07
//   ALPACA_KEY / ALPACA_SECRET
//   PAPER                   'false' for the live endpoint; defaults to paper

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'sae061-ws.myshopify.com';
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '';
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const SHOPIFY_LEGACY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

const shopifyConfigured = !!SHOPIFY_LEGACY_TOKEN || !!(SHOPIFY_CLIENT_ID && SHOPIFY_CLIENT_SECRET);

const ALPACA_KEY = process.env.ALPACA_KEY || '';
const ALPACA_SECRET = process.env.ALPACA_SECRET || '';
const ALPACA_PAPER = String(process.env.PAPER || 'true') !== 'false';
const ALPACA_BASE = ALPACA_PAPER
  ? 'https://paper-api.alpaca.markets'
  : 'https://api.alpaca.markets';

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

// ===== Shopify auth =====

// Cached access token. Shopify issues these for ~24h; we refresh at 90% of
// the stated lifetime so a request never lands on an expiring token.
let tokenCache = { value: '', expiresAt: 0 };

async function getShopifyToken() {
  if (SHOPIFY_LEGACY_TOKEN) return SHOPIFY_LEGACY_TOKEN;

  if (tokenCache.value && Date.now() < tokenCache.expiresAt) {
    return tokenCache.value;
  }

  // Form-encoded, per Shopify's client-credentials-grant docs. A JSON body
  // here returns a 400 with a non-JSON error page.
  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(10000),
  });

  // Read as text first. Shopify's OAuth errors ("Oauth error shop_not_permitted",
  // "application_cannot_be_found") come back as plain text, not JSON, and get
  // lost entirely if we only try to parse JSON.
  const raw = await res.text();
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // leave body empty; raw is what we report
  }

  if (!res.ok || !body.access_token) {
    const detail = body.error_description || body.error || raw.slice(0, 300) || '(empty response body)';
    console.error(`[shopify] token request failed ${res.status}: ${detail}`);
    throw new Error(`shopify_token_${res.status}: ${detail}`);
  }

  const lifetimeMs = Number(body.expires_in || 86400) * 1000;
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + lifetimeMs * 0.9,
  };

  console.log(
    `[shopify] minted access token, valid ~${Math.round(lifetimeMs / 3600000)}h, scopes: ${body.scope || 'unknown'}`
  );
  return tokenCache.value;
}

async function shopifyGraphQL(query, variables = {}) {
  const token = await getShopifyToken();

  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10000),
  });

  const raw = await res.text();
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // leave body empty; raw is reported below
  }

  // A 401 on a token we thought was good means it was revoked early.
  // Drop the cache so the next call mints a fresh one.
  if (res.status === 401) {
    tokenCache = { value: '', expiresAt: 0 };
  }

  if (!res.ok) {
    console.error(`[shopify] graphql ${res.status}: ${raw.slice(0, 300)}`);
    throw new Error(`shopify_${res.status}: ${raw.slice(0, 200)}`);
  }
  if (body.errors) {
    console.error(`[shopify] graphql errors: ${JSON.stringify(body.errors).slice(0, 300)}`);
    throw new Error(`shopify_graphql: ${JSON.stringify(body.errors).slice(0, 200)}`);
  }

  return body.data;
}

const ORDERS_QUERY = `
  query MikeOrders($q: String!) {
    orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          name
          createdAt
          displayFulfillmentStatus
          displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 20) {
            edges { node { title quantity } }
          }
        }
      }
    }
  }
`;

export async function getStoreSales({ days } = {}) {
  if (!shopifyConfigured) {
    return {
      configured: false,
      note: 'Shopify is not connected yet - no Shopify credentials are set on the server.',
    };
  }

  const window = Math.min(Math.max(Number(days) || 7, 1), 90);
  const since = new Date(Date.now() - window * 86400_000);
  const sinceDay = since.toISOString().slice(0, 10);

  const data = await shopifyGraphQL(ORDERS_QUERY, { q: `created_at:>=${sinceDay}` });
  const orders = (data?.orders?.edges || []).map((e) => e.node);

  console.log(`[shopify] store sales ok - ${orders.length} orders in last ${window}d`);

  let gross = 0;
  let currency = 'USD';
  const productCounts = new Map();

  for (const order of orders) {
    const amount = order?.currentTotalPriceSet?.shopMoney?.amount;
    gross += Number(amount || 0);
    currency = order?.currentTotalPriceSet?.shopMoney?.currencyCode || currency;

    for (const li of order?.lineItems?.edges || []) {
      const title = li?.node?.title || 'Unknown item';
      productCounts.set(title, (productCounts.get(title) || 0) + Number(li?.node?.quantity || 0));
    }
  }

  const topProducts = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([title, units]) => ({ title, units }));

  return {
    configured: true,
    store: 'Doer Tough (doertough.com)',
    windowDays: window,
    since: sinceDay,
    orderCount: orders.length,
    grossSales: money(gross),
    currency,
    averageOrderValue: orders.length ? money(gross / orders.length) : 0,
    topProducts,
    recentOrders: orders.slice(0, 5).map((o) => ({
      order: o.name,
      placedAt: o.createdAt,
      total: money(o?.currentTotalPriceSet?.shopMoney?.amount),
      payment: o.displayFinancialStatus,
      fulfillment: o.displayFulfillmentStatus,
    })),
    note: orders.length
      ? undefined
      : `No orders in the last ${window} days. The store is live, it just hasn't sold in this window.`,
  };
}

// ===== Alpaca =====

async function alpaca(pathname) {
  const res = await fetch(`${ALPACA_BASE}${pathname}`, {
    headers: {
      'APCA-API-KEY-ID': ALPACA_KEY,
      'APCA-API-SECRET-KEY': ALPACA_SECRET,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 401 || res.status === 403) {
    const raw = await res.text().catch(() => '');
    console.error(`[bot] alpaca ${res.status} on ${ALPACA_BASE}${pathname}: ${raw.slice(0, 200)}`);
    throw new Error('alpaca_unauthorized');
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    console.error(`[bot] alpaca ${res.status} on ${ALPACA_BASE}${pathname}: ${raw.slice(0, 200)}`);
    throw new Error(`alpaca_${res.status}`);
  }

  return res.json();
}

export async function getBotStatus() {
  if (!ALPACA_KEY || !ALPACA_SECRET) {
    console.warn('[bot] ALPACA_KEY / ALPACA_SECRET not set on this service');
    return {
      configured: false,
      note: 'The trading account is not connected here - ALPACA_KEY / ALPACA_SECRET are not set on this server.',
    };
  }

  console.log(`[bot] querying alpaca ${ALPACA_PAPER ? 'paper' : 'live'} endpoint (${ALPACA_BASE})`);

  let account;
  try {
    account = await alpaca('/v2/account');
  } catch (err) {
    if (String(err.message) === 'alpaca_unauthorized') {
      console.error(
        `[bot] credentials rejected on the ${ALPACA_PAPER ? 'paper' : 'live'} endpoint - check PAPER matches the key type`
      );
      return {
        configured: true,
        error: 'auth_failed',
        mode: ALPACA_PAPER ? 'paper' : 'live',
        note: `Alpaca rejected the credentials on the ${ALPACA_PAPER ? 'paper' : 'live'} endpoint. Paper and live keys are separate pairs and can't be swapped.`,
      };
    }
    throw err;
  }

  let positions = [];
  try {
    positions = await alpaca('/v2/positions');
  } catch (err) {
    console.error('[bot] positions failed:', err.message || err);
  }

  const equity = money(account.equity);
  const cash = money(account.cash);

  console.log(
    `[bot] alpaca ok - status ${account.status}, equity ${equity}, ${positions.length} open positions`
  );

  return {
    configured: true,
    mode: ALPACA_PAPER ? 'paper' : 'live',
    accountStatus: account.status,
    tradingBlocked: !!account.trading_blocked,
    equity,
    cash,
    buyingPower: money(account.buying_power),
    openPositions: positions.length,
    positions: positions.slice(0, 10).map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      marketValue: money(p.market_value),
      unrealizedPL: money(p.unrealized_pl),
      unrealizedPLPercent: money(Number(p.unrealized_plpc || 0) * 100),
    })),
    note:
      equity === 0
        ? 'The account is funded at zero, so the bot cannot open new positions regardless of signals.'
        : undefined,
  };
}

// ===== Tool schemas =====
export const BUSINESS_TOOLS = [
  {
    type: 'function',
    name: 'get_store_sales',
    description:
      "Get recent sales performance for Mike's Doer Tough Shopify store: order count, gross sales, average order value, best-selling products, and the most recent orders. Use for any question about how the store or the business is doing.",
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'How many days back to look. Defaults to 7, max 90.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_bot_status',
    description:
      "Get the current state of Mike's automated trading account on Alpaca: paper or live mode, account status, equity, cash, buying power, and open positions with unrealized P/L. Use for any question about the bot, DoerBot, StockBot, or how trading is going.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

export const BUSINESS_TOOL_HANDLERS = {
  get_store_sales: getStoreSales,
  get_bot_status: getBotStatus,
};
