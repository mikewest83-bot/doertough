// server/billing.mjs
//
// Stripe Checkout and Billing Portal, created server-side so every payment
// carries the account it belongs to.
//
// The old flow sent people to a bare payment link, which produced Stripe
// customers with no way to match them back to a Mike AI account. Here the
// session is created with client_reference_id set to the user's id, so the
// webhook can write entitlement onto the right row.
//
// Talks to Stripe over plain HTTPS rather than the SDK - it is three form
// posts and this keeps the dependency list unchanged.
//
// Env:
//   STRIPE_SECRET_KEY   REQUIRED. sk_live_... or sk_test_...
//   STRIPE_PRICE_ID     REQUIRED. The recurring price for Mike AI Pro.
//   PUBLIC_APP_URL      Optional. Defaults to the production domain.
//   PRO_TRIAL_DAYS      Optional. Defaults to 7.

const STRIPE_API = 'https://api.stripe.com/v1';
const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const APP_URL = process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com';
const TRIAL_DAYS = Number(process.env.PRO_TRIAL_DAYS || 7);

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
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form(params),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    // leave data empty; the error below carries the raw response
  }

  if (!res.ok) {
    const message = data?.error?.message || raw.slice(0, 300) || 'unknown stripe error';
    const err = new Error(`stripe_${res.status}: ${message}`);
    err.status = 502;
    throw err;
  }

  return data;
}

/**
 * Creates a Checkout Session for one signed-in user and returns its URL.
 *
 * client_reference_id is the load-bearing part: it is what lets the webhook
 * find the account when the payment lands. An existing Stripe customer is
 * reused so a returning subscriber doesn't end up with two customer records.
 */
export async function createCheckoutSession(user) {
  if (!billingConfigured()) {
    const err = new Error('billing_not_configured');
    err.status = 503;
    throw err;
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

  if (TRIAL_DAYS > 0) {
    params['subscription_data[trial_period_days]'] = TRIAL_DAYS;
  }

  // Reuse the customer if we already know it; otherwise let Stripe create one
  // against this email so the receipt goes to the right place.
  if (user.stripe_customer_id) {
    params.customer = user.stripe_customer_id;
  } else {
    params.customer_email = user.email;
  }

  const session = await stripePost('/checkout/sessions', params);
  return { url: session.url, id: session.id };
}

/**
 * Billing portal, so subscribers can cancel or update a card without
 * emailing Mike. Requires a known Stripe customer.
 */
export async function createPortalSession(user) {
  if (!billingConfigured()) {
    const err = new Error('billing_not_configured');
    err.status = 503;
    throw err;
  }
  if (!user.stripe_customer_id) {
    const err = new Error('no_subscription');
    err.status = 400;
    throw err;
  }

  const session = await stripePost('/billing_portal/sessions', {
    customer: user.stripe_customer_id,
    return_url: `${APP_URL}/`,
  });

  return { url: session.url };
}

/**
 * Reads a subscription back from Stripe. Used by the webhook when an event
 * carries a subscription id but not its current state.
 */
export async function fetchSubscription(subscriptionId) {
  if (!billingConfigured() || !subscriptionId) return null;

  const res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });

  if (!res.ok) {
    console.error(`[billing] could not read subscription ${subscriptionId}: ${res.status}`);
    return null;
  }

  return res.json();
}
