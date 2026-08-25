// server/billing.mjs
// Stripe Checkout and Billing Portal for Mike AI Pro.

const STRIPE_API = 'https://api.stripe.com/v1';
const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const APP_URL = process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com';
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

export async function createCheckoutSession(user) {
  if (!billingConfigured()) {
    const err = new Error('billing_not_configured'); err.status = 503; throw err;
  }
  const params = {
    mode: 'subscription',
    'line_items[0][price]': PRICE_ID,
    'line_items[0][quantity]': 1,
    client_reference_id: String(user.id),
    success_url: `${APP_URL}/?checkout=success`,
    cancel_url: `${APP_URL}/?checkout=cancelled`,
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
  const session = await stripePost('/billing_portal/sessions', { customer: user.stripe_customer_id, return_url: `${APP_URL}/` });
  return { url: session.url };
}

export async function fetchSubscription(subscriptionId) {
  if (!billingConfigured() || !subscriptionId) return null;
  const res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Bearer ${SECRET}` } });
  if (!res.ok) return null;
  return res.json();
}
