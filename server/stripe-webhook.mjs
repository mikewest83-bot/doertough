import crypto from 'crypto';
import {
  dbEnabled,
  getUserById,
  getUserByStripeCustomer,
  attachStripeCustomer,
  setSubscriptionState,
} from './db.mjs';
import { fetchSubscription } from './billing.mjs';
import {
  claimStripeEvent,
  markStripeEventProcessed,
  releaseStripeEvent,
} from './stripe-idempotency.mjs';

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

const PRO_STATUSES = new Set(['active', 'trialing']);

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

async function processStripeWebhookEvent(event) {
  switch (event.type) {
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

      await attachStripeCustomer(user.id, session.customer, session.subscription);

      const subscription = await fetchSubscription(session.subscription);
      if (!subscription) {
        console.error(
          `[stripe] checkout ${session.id} subscription ${session.subscription} could not be verified - entitlement unchanged`
        );
        return;
      }

      await applySubscription({ ...user, id: user.id }, subscription);
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
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
      return;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const user = await getUserByStripeCustomer(invoice.customer);
      if (!user) return;

      console.warn(`[stripe] payment failed for ${user.email} (invoice ${invoice.id})`);
      return;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const user = await getUserByStripeCustomer(invoice.customer);
      if (!user) return;

      const subscriptionId = subscriptionIdOf(invoice);
      if (!subscriptionId) {
        console.log(`[stripe] invoice ${invoice.id} is not subscription-linked, ignoring`);
        return;
      }

      const subscription = await fetchSubscription(subscriptionId);
      if (subscription) await applySubscription(user, subscription);
      return;
    }

    default:
      return;
  }
}

export async function handleStripeWebhook(event) {
  console.log(`[stripe] received ${event.type} (${event.id})`);

  if (!dbEnabled) {
    console.error('[stripe] database not configured - cannot record entitlement');
    return;
  }

  // Stripe retries deliveries. Claim the event before processing so concurrent
  // or repeated deliveries cannot apply entitlement changes twice. A failed
  // attempt releases the claim, allowing Stripe's retry to run normally.
  const claimed = await claimStripeEvent(event.id);
  if (!claimed) {
    console.log(`[stripe] duplicate event ${event.id} ignored`);
    return;
  }

  try {
    await processStripeWebhookEvent(event);
    await markStripeEventProcessed(event.id);
  } catch (err) {
    await releaseStripeEvent(event.id).catch((releaseErr) => {
      console.error('[stripe] failed to release webhook claim:', releaseErr.message || releaseErr);
    });
    throw err;
  }
}
