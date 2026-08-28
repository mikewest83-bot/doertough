import { query } from './db.mjs';

// Claim an event atomically. Duplicate deliveries are ignored. A processing
// claim older than ten minutes can be reclaimed, covering a crashed worker.
export async function claimStripeEvent(eventId) {
  if (!eventId) return true;

  const { rowCount } = await query(
    `INSERT INTO stripe_webhook_events (event_id, status)
     VALUES ($1, 'processing')
     ON CONFLICT (event_id) DO UPDATE
       SET status = 'processing', received_at = now(), processed_at = NULL
       WHERE stripe_webhook_events.status = 'processing'
         AND stripe_webhook_events.received_at < now() - interval '10 minutes'`,
    [eventId]
  );

  return rowCount === 1;
}

export async function markStripeEventProcessed(eventId) {
  if (!eventId) return;
  await query(
    `UPDATE stripe_webhook_events
        SET status = 'processed', processed_at = now()
      WHERE event_id = $1 AND status = 'processing'`,
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
