import crypto from 'crypto';

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

export async function handleStripeWebhook(event) {
  console.log(`[stripe] received ${event.type} (${event.id})`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log('[stripe] checkout completed', {
        customer: session.customer || null,
        subscription: session.subscription || null,
      });
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      console.log('[stripe] subscription change', {
        id: subscription.id,
        status: subscription.status,
        customer: subscription.customer,
        priceId: subscription.items?.data?.[0]?.price?.id || null,
        currentPeriodEnd: subscription.items?.data?.[0]?.current_period_end || null,
      });
      break;
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log('[stripe] invoice change', {
        id: invoice.id,
        customer: invoice.customer || null,
        subscription: invoice.subscription || null,
        status: invoice.status || null,
      });
      break;
    }

    default:
      // Stripe can send many events. Unhandled events are intentionally ignored.
      break;
  }
}
