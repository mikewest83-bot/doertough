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
//   PGSSL          'false' to force SSL off; 'no-verify' to use TLS but skip cert verification
//                  (use the explicit 'no-verify' token only when you fully understand the risks)
//

import pg from 'pg';

const { Pool } = pg;

const CONNECTION_STRING = process.env.DATABASE_URL || '';

export const dbEnabled = !!CONNECTION_STRING;

// Railway's internal hostname speaks plaintext inside the private network.
// The public proxy host needs TLS, and its cert isn't in the container's
// trust store, hence we special-case railway.internal as non-TLS. For all
// other hosts we default to verifying certs (rejectUnauthorized: true).
// To explicitly opt out of cert verification (not recommended for prod),
// set PGSSL=no-verify. To disable TLS entirely (local/dev), set PGSSL=false.
function sslSetting() {
  const pgssl = String(process.env.PGSSL || '').toLowerCase();

  if (pgssl === 'false') return false;
  if (!CONNECTION_STRING) return false;

  // Private Railway internal hostname uses plaintext inside their VPC.
  if (CONNECTION_STRING.includes('.railway.internal')) return false;

  // Local development
  if (CONNECTION_STRING.includes('localhost')) return false;
  if (CONNECTION_STRING.includes('127.0.0.1')) return false;

  // Allow explicit opt-out from cert verification only when explicitly requested:
  if (pgssl === 'no-verify') {
    return { rejectUnauthorized: false };
  }

  // Default: require valid certificates
  return { rejectUnauthorized: true };
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

  // Graceful shutdown so the pool can close client connections cleanly.
  const shutdown = async () => {
    try {
      await pool.end();
      console.log('[db] pool closed');
    } catch (err) {
      // swallow errors during shutdown
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', shutdown);
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

-- Bumped whenever a password changes. The number is baked into every JWT, so
-- raising it invalidates tokens issued before the change - a stolen or shared
-- session cannot outlive a password reset.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

-- Password reset tickets. Only the SHA-256 of the token is stored, so a leak
-- of this table does not hand anyone a working reset link. Single use, and
-- short lived.
CREATE TABLE IF NOT EXISTS password_resets (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS password_resets_hash_idx ON password_resets (token_hash);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);

-- One row per realtime voice session handed out. This is what stops a single
-- visitor consuming the workspace's monthly ElevenLabs minutes.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users (id) ON DELETE CASCADE,
  engine_id   TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Minute accounting. ElevenLabs bills by the minute, not by the session, so
-- a session count alone can't bound the cost: a 20-second chat and a
-- 10-minute one used to cost the same against the budget.
--
-- reserved_seconds is charged UP FRONT at the worst case (the engine's own
-- max_duration_seconds). actual_seconds replaces it when the client reports
-- the real duration on hangup. A session that is never reported -- crash,
-- closed tab, hostile client -- keeps its full reservation, so the budget
-- fails CLOSED rather than leaking free minutes.
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS reserved_seconds INT NOT NULL DEFAULT 600;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS actual_seconds   INT;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS session_key      TEXT;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS ended_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS voice_sessions_user_time_idx ON voice_sessions (user_id, started_at);
CREATE INDEX IF NOT EXISTS voice_sessions_time_idx ON voice_sessions (started_at);
CREATE UNIQUE INDEX IF NOT EXISTS voice_sessions_key_idx ON voice_sessions (session_key)
  WHERE session_key IS NOT NULL;

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

// Issue a reset ticket. Any older unused ticket for this account is burned
// first, so requesting a second link silently kills the first.
export async function createPasswordReset(userId, tokenHash, expiresAt) {
  await query(
    `UPDATE password_resets SET used_at = now()
      WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  const { rows } = await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, tokenHash, expiresAt]
  );
  return rows[0];
}

export async function findPasswordReset(tokenHash) {
  const { rows } = await query(
    `SELECT * FROM password_resets
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()`,
    [tokenHash]
  );
  return rows[0] || null;
}

// Consume the ticket and set the new password in one shot. token_version is
// bumped in the same statement, which signs out every existing session.
//
// This is now done transactionally and verifies the reset row belongs to the
// provided userId. That prevents using a valid reset id for someone else.
export async function consumePasswordReset(resetId, userId, passwordHash) {
  if (!pool) throw new Error('database_not_configured');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark the specific reset used, but only if it belongs to the user and is unused.
    const { rows: resetRows } = await client.query(
      `UPDATE password_resets
         SET used_at = now()
       WHERE id = $1
         AND user_id = $2
         AND used_at IS NULL
       RETURNING id`,
      [resetId, userId]
    );

    if (!resetRows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    // Update the user's password and bump token_version atomically.
    const { rows: updatedRows } = await client.query(
      `UPDATE users
          SET password_hash = $2,
              token_version = token_version + 1
        WHERE id = $1
        RETURNING *`,
      [userId, passwordHash]
    );

    await client.query('COMMIT');
    return updatedRows[0] || null;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
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

// The owner account is allowed to test the complete paid experience without
// having to purchase its own subscription. This is server-side only and is
// controlled by OWNER_EMAIL, which is also used by auth.mjs for owner access.
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();

// The single source of truth for "is this account paid". A trial counts as
// paid - that is the whole point of the trial - but it still has to be a
// trial Stripe told us about. The owner is the sole intentional exception
// for product testing.
const ENTITLED_STATUSES = new Set(['active', 'trialing']);

export function hasPro(user) {
  if (!user) return false;
  if (OWNER_EMAIL && normalizeEmail(user.email) === OWNER_EMAIL) return true;
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

export async function recordVoiceSession(userId, engineId, { sessionKey, reservedSeconds } = {}) {
  const { rows } = await query(
    `INSERT INTO voice_sessions (user_id, engine_id, session_key, reserved_seconds)
     VALUES ($1, $2, $3, COALESCE($4, 600))
     RETURNING *`,
    [userId, engineId || null, sessionKey || null, reservedSeconds ?? null]
  );
  return rows[0];
}

// Reconcile a finished session down to what it actually used. Single-use: the
// WHERE clause refuses a second report for the same key, so a replayed call
// can't keep shrinking the bill. The caller is responsible for clamping
// `seconds` to the per-session maximum before this is reached.
// Settling a reservation. The client reports how long the call actually
// ran, which lets a short call release the minutes it did not use.
//
// The reported number is a FLOOR-RAISER ONLY, never a discount: the billed
// duration is the greater of what the client claims and what the server's
// own clock says has elapsed since the reservation was created, then capped
// at the reservation itself.
export async function closeVoiceSession(sessionKey, userId, seconds) {
  if (!sessionKey) return null;
  const reported = Math.max(0, Math.round(Number(seconds) || 0));
  const { rows } = await query(
    `UPDATE voice_sessions
        SET actual_seconds = LEAST(
              reserved_seconds,
              GREATEST(
                $3::int,
                CEIL(EXTRACT(EPOCH FROM (now() - started_at)))::int
              )
            ),
            ended_at = now()
      WHERE session_key = $1
        AND user_id = $2
        AND actual_seconds IS NULL
      RETURNING *`,
    [String(sessionKey), userId, reported]
  );
  return rows[0] || null;
}

// The voice budget resets on a rolling 30-day window.
// Only count sessions that are either:
// - Closed (ended_at IS NOT NULL), or
// - Older than the session max duration (timed out/abandoned)
export async function countVoiceSessions(userId, maxSessionSeconds = 600) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM voice_sessions
      WHERE user_id = $1
        AND started_at >= now() - interval '30 days'
        AND (ended_at IS NOT NULL OR started_at <= now() - interval '1 second' * $2)`,
    [userId, maxSessionSeconds]
  );
  return parseInt(rows[0]?.count || '0', 10);
}

// Workspace-wide pool. This protects the ElevenLabs account from a busy day
// draining the month's allowance for everyone.
// Only count sessions that are either closed or timed out.
export async function countVoiceSessionsGlobal(maxSessionSeconds = 600) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM voice_sessions
      WHERE started_at >= now() - interval '30 days'
        AND (ended_at IS NOT NULL OR started_at <= now() - interval '1 second' * $1)`,
    [maxSessionSeconds]
  );
  return parseInt(rows[0]?.count || '0', 10);
}

// Minutes actually owed, on the same rolling 30-day window. An open session
// counts at its full reservation until it reports in OR times out.
// Only count sessions that are either closed or timed out.
export async function countVoiceSeconds(userId, maxSessionSeconds = 600) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(COALESCE(actual_seconds, reserved_seconds)), 0)::int AS seconds
       FROM voice_sessions
      WHERE user_id = $1
        AND started_at >= now() - interval '30 days'
        AND (ended_at IS NOT NULL OR started_at <= now() - interval '1 second' * $2)`,
    [userId, maxSessionSeconds]
  );
  return parseInt(rows[0]?.seconds || '0', 10);
}

export async function countVoiceSecondsGlobal(maxSessionSeconds = 600) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(COALESCE(actual_seconds, reserved_seconds)), 0)::int AS seconds
       FROM voice_sessions
      WHERE started_at >= now() - interval '30 days'
        AND (ended_at IS NOT NULL OR started_at <= now() - interval '1 second' * $1)`,
    [maxSessionSeconds]
  );
  return parseInt(rows[0]?.seconds || '0', 10);
}

// ===== Conversations =====

export async function createConversation(userId) {
  const { rows } = await query(
    `INSERT INTO conversations (user_id) VALUES ($1) RETURNING *`,
    [userId]
  );
  return rows[0];
}

export async function addMessage(conversationId, role, content) {
  const { rows } = await query(
    `INSERT INTO messages (conversation_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [conversationId, role, String(content || '')]
  );
  return rows[0];
}

export async function listConversations(userId) {
  const { rows } = await query(
    `SELECT c.id, c.created_at,
            (SELECT m.content FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_message
       FROM conversations c
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
      LIMIT 50`,
    [userId]
  );
  return rows;
}

export async function listMessages(userId, conversationId) {
  const { rows } = await query(
    `SELECT m.id, m.role, m.content, m.created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.id = $1 AND c.user_id = $2
      ORDER BY m.created_at ASC`,
    [conversationId, userId]
  );
  return rows;
}
