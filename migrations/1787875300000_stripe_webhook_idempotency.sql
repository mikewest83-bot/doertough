CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id     TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'processing',
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_received_idx
  ON stripe_webhook_events (received_at);
