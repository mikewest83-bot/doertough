// server/db.mjs
//
// Postgres for Mike AI: accounts now, per-user memory next.
//
// Degrades safely. If DATABASE_URL is not set, dbEnabled is false, the app
// still boots, and the auth routes return a clean 503 instead of crashing.
// That means this file can ship before the database exists.
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
