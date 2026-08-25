// server/db.mjs
//
// Postgres for Mike AI: accounts, subscription entitlement, voice metering,
// and saved conversations.
//
// Degrades safely. If DATABASE_URL is not set, dbEnabled is false, the app
// still boots, and the auth routes return a clean 503 instead of crashing.
//
// Env:
//   DATABASE_URL   Railway sets this when you attach a Postgres service
//   PGSSL          'false' to force SSL off; default is auto-detected

import pg from 'pg';

const { Pool } = pg;

const CONNECTION_STRING = process.env.DATABASE_URL || '';

export const dbEnabled = !!CONNECTION_STRING;

// Railway's internal hostname speaks plaintext inside the private network.
// The public proxy host needs TLS, and its cert isn't in the container's
// trust store, hence rejectUnauthorized: false.
function sslSetting() {
  if (String(process.env.PGSSL || '') === 'false') return false;
  if (!CONNECTION_STRING) return false;
  if (CONNECTION_STRING.includes('.railway.internal')) return false;
  if (CONNECTION_STRING.includes('localhost')) return false;
  if (CONNECTION_STRING.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

export const pool = dbEnabled
  ? new Pool({
      connectionString: CONNECTION_STRING,
      ssl: sslSetting(),
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

if (pool) {
  // An idle client erroring out must not take the process down.
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message || err);
  });
}

export async function query(text, params = []) {
  if (!pool) throw new Error('database_not_configured');
  return pool.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Subscription state. Everything here is written by the Stripe webhook and
-- read by hasPro(); nothing the browser sends can set it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan                   TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_end              TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_stripe_customer_idx ON users (stripe_customer_id);

-- One row per realtime voice session handed out. This is what stops a single
-- visitor consuming the workspace's monthly ElevenLabs minutes.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users (id) ON DELETE CASCADE,
  engine_id   TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_sessions_user_time_idx ON voice_sessions (user_id, started_at);
CREATE INDEX IF NOT EXISTS voice_sessions_time_idx ON voice_sessions (started_at);

-- Saved conversations, so history is built server-side instead of being
-- posted up by the browser on every turn.
CREATE TABLE IF NOT EXISTS conversations (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);
`;

// Runs on every boot. Every statement is IF NOT EXISTS, so it is safe to
// run repeatedly and safe to run on a database that already has data.
export async function migrate() {
  if (!dbEnabled) {
    console.warn('[db] DATABASE_URL not set - accounts are disabled');
    return false;
  }

  try {
    await query(SCHEMA);
    console.log('[db] connected, schema ready');
    return true;
  } catch (err) {
    console.error('[db] migration failed:', err.message || err);
    return false;
  }
}

// ===== Users =====

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export async function getUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [
    normalizeEmail(email),
  ]);
  return rows[0] || null;
}

export async function getUserById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createUser({ email, name, passwordHash }) {
  const { rows } = await query(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [normalizeEmail(email), String(name).trim(), passwordHash]
  );
  return rows[0];
}

export async function touchUser(id) {
  try {
    await query('UPDATE users SET last_seen_at = now() WHERE id = $1', [id]);
  } catch (err) {
    // Never let a bookkeeping write break a request.
    console.error('[db] touchUser failed:', err.message || err);
  }
}

// ===== Subscription =====

// The single source of truth for "is this account paid". A trial counts as
// paid - that is the whole point of the trial - but it still has to be a
// trial Stripe told us about.
const ENTITLED_STATUSES = new Set(['active', 'trialing']);

export function hasPro(user) {
  if (!user) return false;
  if (user.plan !== 'pro') return false;
  if (!ENTITLED_STATUSES.has(String(user.subscription_status || ''))) return false;
  if (user.current_period_end && new Date(user.current_period_end) < new Date()) return false;
  return true;
}

export async function getUserByStripeCustomer(customerId) {
  if (!customerId) return null;
  const { rows } = await query('SELECT * FROM users WHERE stripe_customer_id = $1', [
    String(customerId),
  ]);
  return rows[0] || null;
}

export async function attachStripeCustomer(userId, customerId, subscriptionId) {
  const { rows } = await query(
    `UPDATE users
        SET stripe_customer_id = COALESCE($2, stripe_customer_id),
            stripe_subscription_id = COALESCE($3, stripe_subscription_id)
      WHERE id = $1
      RETURNING *`,
    [userId, customerId || null, subscriptionId || null]
  );
  return rows[0] || null;
}

export async function setSubscriptionState(userId, {
  plan,
  status,
  subscriptionId,
  currentPeriodEnd,
  trialEnd,
}) {
  const { rows } = await query(
    `UPDATE users
        SET plan = $2,
            subscription_status = $3,
            stripe_subscription_id = COALESCE($4, stripe_subscription_id),
            current_period_end = $5,
            trial_end = COALESCE($6, trial_end)
      WHERE id = $1
      RETURNING *`,
    [
      userId,
      plan,
      status || null,
      subscriptionId || null,
      currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      trialEnd ? new Date(trialEnd * 1000) : null,
    ]
  );
  return rows[0] || null;
}

// ===== Voice metering =====

export async function recordVoiceSession(userId, engineId) {
  await query('INSERT INTO voice_sessions (user_id, engine_id) VALUES ($1, $2)', [
    userId,
    engineId || null,
  ]);
}

// Sessions this user has started in the last 30 days.
export async function countVoiceSessions(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM voice_sessions
      WHERE user_id = $1 AND started_at > now() - interval '30 days'`,
    [userId]
  );
  return rows[0]?.n || 0;
}

// Sessions across every account in the last 30 days. This is the backstop
// against the workspace's ElevenLabs minutes being drained in a day.
export async function countVoiceSessionsGlobal() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM voice_sessions
      WHERE started_at > now() - interval '30 days'`
  );
  return rows[0]?.n || 0;
}

// ===== Conversations =====

export async function createConversation(userId) {
  const { rows } = await query(
    'INSERT INTO conversations (user_id) VALUES ($1) RETURNING id',
    [userId]
  );
  return rows[0].id;
}

export async function conversationBelongsTo(conversationId, userId) {
  const { rows } = await query(
    'SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2',
    [conversationId, userId]
  );
  return rows.length > 0;
}

export async function addMessage(conversationId, role, content) {
  await query(
    'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
    [conversationId, role, String(content).slice(0, 8000)]
  );
}

// Most recent turns, oldest first, for feeding back into the model.
export async function recentMessages(conversationId, limit = 10) {
  const { rows } = await query(
    `SELECT role, content FROM (
       SELECT role, content, created_at
         FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT $2
     ) recent ORDER BY created_at ASC`,
    [conversationId, limit]
  );
  return rows;
}
