/* node-pg-migrate migration: initial schema
   The numeric prefix is required by node-pg-migrate v8. Existing databases
   may already record the legacy migration name `001-initial-schema`.
   The migrate command disables order checking so this idempotent baseline can
   safely reconcile existing databases while still initializing fresh ones.
*/

exports.shorthands = undefined;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_stripe_customer_idx ON users (stripe_customer_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS password_resets_hash_idx ON password_resets (token_hash);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);
CREATE TABLE IF NOT EXISTS voice_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users (id) ON DELETE CASCADE,
  engine_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS reserved_seconds INT NOT NULL DEFAULT 600;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS actual_seconds INT;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS session_key TEXT;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS voice_sessions_user_time_idx ON voice_sessions (user_id, started_at);
CREATE INDEX IF NOT EXISTS voice_sessions_time_idx ON voice_sessions (started_at);
CREATE UNIQUE INDEX IF NOT EXISTS voice_sessions_key_idx ON voice_sessions (session_key) WHERE session_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE
  ,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);
`;

exports.up = (pgm) => pgm.sql(SCHEMA_SQL);
exports.down = (pgm) => {
  pgm.dropTable('messages', { ifExists: true, cascade: true });
  pgm.dropTable('conversations', { ifExists: true, cascade: true });
  pgm.dropTable('voice_sessions', { ifExists: true, cascade: true });
  pgm.dropTable('password_resets', { ifExists: true, cascade: true });
  pgm.dropTable('users', { ifExists: true, cascade: true });
};
