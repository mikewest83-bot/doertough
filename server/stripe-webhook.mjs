import crypto from 'crypto';
import {
  dbEnabled,
  getUserById,
  getUserByStripeCustomer,
  attachStripeCustomer,
  setSubscriptionState,
} from './db.mjs';
import { fetchSubscription } from './billing.mjs';

/**
 * Stripe webhook verification without exposing the Stripe secret to the browser.
 * Set STRIPE_WEBHOOK_SECRET to the whsec_... value Stripe gives this endpoint.
 */
export function verifyStripeSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;

  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const [key, value] = part.split('=', 2);
      return [key, value];
    })
  );

  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  // Five-minute tolerance helps prevent replay attacks.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(v1, 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function stripeWebhookConfigured() {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

// A subscription is worth Pro while Stripe says it is active or in trial.
// Anything else - past_due, canceled, unpaid, incomplete - drops to free.
const PRO_STATUSES = new Set(['active', 'trialing']);

// Stripe's 2025-03-31 "Basil" API version removed `invoice.subscription` and
// moved it to `invoice.parent.subscription_details.subscription`. Read both,
// so this works whichever API version the account is pinned to. Without this
// the invoice.paid branch below silently no-ops on a current version.
function subscriptionIdOf(invoice) {
  if (!invoice) return null;
  if (invoice.parent?.type === 'subscription_details') {
    const fromParent = invoice.parent?.subscription_details?.subscription;
    if (fromParent) return typeof fromParent === 'string' ? fromParent : fromParent.id;
  }
  const legacy = invoice.subscription;
  if (legacy) return typeof legacy === 'string' ? legacy : legacy.id;
  return null;
}

function periodEndOf(subscription) {
  return (
    subscription?.current_period_end ||
    subscription?.items?.data?.[0]?.current_period_end ||
    null
  );
}

async function applySubscription(user, subscription) {
  if (!user || !subscription) return;

  const status = subscription.status || null;
  const plan = PRO_STATUSES.has(status) ? 'pro' : 'free';

  await setSubscriptionState(user.id, {
    plan,
    status,
    subscriptionId: subscription.id,
    currentPeriodEnd: periodEndOf(subscription),
    trialEnd: subscription.trial_end || null,
  });

  console.log(`[stripe] ${user.email} -> plan=${plan} status=${status}`);
}

export async function handleStripeWebhook(event) {
  console.log(`[stripe] received ${event.type} (${event.id})`);

  if (!dbEnabled) {
    console.error('[stripe] database not configured - cannot record entitlement');
    return;
  }

  switch (event.type) {
    // The moment a checkout completes we learn which account paid, via the
    // client_reference_id we set when creating the session.
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.client_reference_id;

      if (!userId) {
        console.error(
          `[stripe] checkout ${session.id} has no client_reference_id - cannot match it to an account`
        );
        return;
      }

      const user = await getUserById(userId);
      if (!user) {
        console.error(`[stripe] checkout ${session.id} references unknown user ${userId}`);
        return;
      }

      if (!session.customer || !session.subscription) {
        console.error(
          `[stripe] checkout ${session.id} is missing customer or subscription - cannot establish paid entitlement`
        );
        return;
      }

      // Store the Stripe identifiers so later subscription webhooks can match
      // the account even if this checkout event arrives before them. This does
      // not grant access by itself.
      await attachStripeCustomer(user.id, session.customer, session.subscription);

      // The checkout event alone is not authoritative enough to grant access:
      // verify the actual subscription state first. A transient Stripe lookup
      // failure must leave the existing entitlement unchanged rather than
      // guessing `trialing` and granting paid access.
      const subscription = await fetchSubscription(session.subscription);
      if (!subscription) {
        console.error(
          `[stripe] checkout ${session.id} subscription ${session.subscription} could not be verified - entitlement unchanged`
        );
        return;
      }

      await applySubscription({ ...user, id: user.id }, subscription);
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;

      // Prefer the metadata we set at checkout; fall back to the customer id.
      const metaUserId = subscription.metadata?.mike_user_id;
      const user = metaUserId
        ? await getUserById(metaUserId)
        : await getUserByStripeCustomer(subscription.customer);

      if (!user) {
        console.error(
          `[stripe] subscription ${subscription.id} has no matching account (customer ${subscription.customer})`
        );
        return;
      }

      if (event.type === 'customer.subscription.deleted') {
        await setSubscriptionState(user.id, {
          plan: 'free',
          status: 'canceled',
          subscriptionId: subscription.id,
          currentPeriodEnd: periodEndOf(subscription),
          trialEnd: null,
        });
        console.log(`[stripe] ${user.email} -> plan=free status=canceled`);
        return;
      }

      await applySubscription(user, subscription);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const user = await getUserByStripeCustomer(invoice.customer);
      if (!user) return;

      // Don't cut access on the first failure - Stripe retries, and the
      // subscription events will move the status if it ultimately fails.
      console.warn(`[stripe] payment failed for ${user.email} (invoice ${invoice.id})`);
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const user = await getUserByStripeCustomer(invoice.customer);
      if (!user) return;

      const subscriptionId = subscriptionIdOf(invoice);
      if (!subscriptionId) {
        // A one-off invoice with no subscription attached - nothing to renew.
        console.log(`[stripe] invoice ${invoice.id} is not subscription-linked, ignoring`);
        return;
      }

      const subscription = await fetchSubscription(subscriptionId);
      if (subscription) await applySubscription(user, subscription);
      break;
    }

    default:
      // Stripe can send many events. Unhandled events are intentionally ignored.
      break;
  }
}
