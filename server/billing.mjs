// server/billing.mjs
// Stripe Checkout and Billing Portal for Mike AI Pro.

const STRIPE_API = 'https://api.stripe.com/v1';
const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
// Where Stripe sends the customer back to. This is DELIBERATELY separate from
// PUBLIC_APP_URL: that variable is currently the Railway host and also feeds
// the speech engine's WebSocket URL, which is working and must not move. The
// session cookie is scoped to the custom domain, so returning a paying
// customer to the Railway host lands them logged out on a URL they do not
// recognise, moments after they paid.
//
// Precedence: BILLING_RETURN_URL, then the canonical brand domain. Set
// BILLING_RETURN_URL to http://localhost:3000 for local testing.
const RETURN_URL = String(process.env.BILLING_RETURN_URL || 'https://doertoughmikeai.com').replace(/\/+$/, '');
const TRIAL_DAYS = Number(process.env.PRO_TRIAL_DAYS || 3);

export const billingConfigured = () => !!SECRET && !!PRICE_ID;

function form(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    body.append(key, String(value));
  }
  return body;
}

async function stripePost(path, params) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(params),
  });
  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  if (!res.ok) {
    const message = data?.error?.message || raw.slice(0, 300) || 'unknown stripe error';
    const err = new Error(`stripe_${res.status}: ${message}`);
    err.status = 502;
    throw err;
  }
  return data;
}

// Does Stripe already have a live subscription for this account?
//
// Deliberately NOT hasPro(): that returns true for OWNER_EMAIL regardless of
// billing state, so using it here would send the owner to a portal he has no
// Stripe customer for. This asks the narrower question - did a real
// subscription get recorded - so the owner can still test a real purchase.
export function hasActiveSubscription(user) {
  if (!user) return false;
  if (!user.stripe_customer_id || !user.stripe_subscription_id) return false;
  if (!['active', 'trialing'].includes(String(user.subscription_status || ''))) return false;
  if (user.current_period_end && new Date(user.current_period_end) < new Date()) return false;
  return true;
}

export async function createCheckoutSession(user) {
  if (!billingConfigured()) {
    const err = new Error('billing_not_configured'); err.status = 503; throw err;
  }

  // Refuse to sell a second subscription to an account that already has one.
  // Without this, clicking upgrade twice creates two live subscriptions on one
  // account - the "charged twice for the same billing period" case the refund
  // policy commits us to refunding. Send them to manage what they have instead.
  if (hasActiveSubscription(user)) {
    const err = new Error('already_subscribed');
    err.status = 409;
    throw err;
  }
  const params = {
    mode: 'subscription',
    'line_items[0][price]': PRICE_ID,
    'line_items[0][quantity]': 1,
    client_reference_id: String(user.id),
    success_url: `${RETURN_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${RETURN_URL}/?checkout=cancelled`,
    allow_promotion_codes: 'true',
    'subscription_data[metadata][mike_user_id]': String(user.id),
  };
  if (TRIAL_DAYS > 0) params['subscription_data[trial_period_days]'] = TRIAL_DAYS;
  if (user.stripe_customer_id) params.customer = user.stripe_customer_id;
  else params.customer_email = user.email;
  const session = await stripePost('/checkout/sessions', params);
  return { url: session.url, id: session.id };
}

export async function createPortalSession(user) {
  if (!billingConfigured()) { const err = new Error('billing_not_configured'); err.status = 503; throw err; }
  if (!user.stripe_customer_id) { const err = new Error('no_subscription'); err.status = 400; throw err; }
  const session = await stripePost('/billing_portal/sessions', { customer: user.stripe_customer_id, return_url: `${RETURN_URL}/` });
  return { url: session.url };
}

export async function fetchSubscription(subscriptionId) {
  if (!billingConfigured() || !subscriptionId) return null;
  const res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${SECRET}` } });
  if (!res.ok) return null;
  return res.json();
}
