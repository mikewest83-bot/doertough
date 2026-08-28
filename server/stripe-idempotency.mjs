import { query } from './db.mjs';

// Claim an event atomically. A duplicate delivery is ignored. If an earlier
// attempt crashed before completion, releaseStripeEvent allows Stripe's retry
// to process it again.
export async function claimStripeEvent(eventId) {
  if (!eventId) return true;

  const { rowCount } = await query(
    `INSERT INTO stripe_webhook_events (event_id, status)
     VALUES ($1, 'processing')
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId]
  );

  if (rowCount === 1) return true;

  const { rows } = await query(
    `SELECT status FROM stripe_webhook_events WHERE event_id = $1`,
    [eventId]
  );

  return rows[0]?.status !== 'processed' && rows[0]?.status !== 'processing';
}

export async function markStripeEventProcessed(eventId) {
  if (!eventId) return;
  await query(
    `UPDATE stripe_webhook_events
        SET status = 'processed', processed_at = now()
      WHERE event_id = $1`,
    [eventId]
  );
}

export async function releaseStripeEvent(eventId) {
  if (!eventId) return;
  await query(
    `DELETE FROM stripe_webhook_events
      WHERE event_id = $1 AND status = 'processing'`,
    [eventId]
  );
}
