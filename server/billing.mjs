// server/billing.mjs
// Stripe Checkout and Billing Portal for Mike AI.

const STRIPE_API = 'https://api.stripe.com/v1';
const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
// Keep billing redirects on the canonical app domain. This is deliberately
// separate from PUBLIC_APP_URL so a paid customer returns to the same origin
// where the authenticated session lives.
const RETURN_URL = String(process.env.BILLING_RETURN_URL || 'https://doertoughmikeai.com').replace(/\/+$/, '');
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 3);

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
    const error = new Error(`stripe_${res.status}: ${message}`);
    error.status = 502;
    throw error;
  }
  return data;
}

// Narrow billing-state check used to prevent duplicate subscriptions. This is
// intentionally separate from the paid-access entitlement check because the
// owner account may have test access without a Stripe customer record.
export function hasActiveSubscription(user) {
  if (!user) return false;
  if (!user.stripe_customer_id || !user.stripe_subscription_id) return false;
  if (!['active', 'trialing'].includes(String(user.subscription_status || ''))) return false;
  if (user.current_period_end && new Date(user.current_period_end) < new Date()) return false;
  return true;
}

export async function createCheckoutSession(user) {
  if (!billingConfigured()) {
    const error = new Error('billing_not_configured'); error.status = 503; throw error;
  }
  if (hasActiveSubscription(user)) {
    const error = new Error('already_subscribed'); error.status = 409; throw error;
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
  if (!billingConfigured()) { const error = new Error('billing_not_configured'); error.status = 503; throw error; }
  if (!user.stripe_customer_id) { const error = new Error('no_subscription'); error.status = 400; throw error; }
  const session = await stripePost('/billing_portal/sessions', {
    customer: user.stripe_customer_id,
    return_url: `${RETURN_URL}/`,
  });
  return { url: session.url };
}

export async function fetchSubscription(subscriptionId) {
  if (!billingConfigured() || !subscriptionId) return null;
  const res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  if (!res.ok) return null;
  return res.json();
}
