import crypto from 'crypto';
import { query } from './db.mjs';

const CLIENT_ID = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com').replace(/\/+$/, '');
const REDIRECT_URI = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || `${PUBLIC_APP_URL}/api/integrations/google/callback`).trim();
const KEY_HEX = String(process.env.GOOGLE_OAUTH_ENCRYPTION_KEY || '').trim();
const STATE_TTL_MINUTES = 10;

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
];

const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET && /^[0-9a-fA-F]{64}$/.test(KEY_HEX));

function key() {
  if (!configured()) throw new Error('google_oauth_not_configured');
  return Buffer.from(KEY_HEX, 'hex');
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decrypt(value) {
  const [ivRaw, tagRaw, dataRaw] = String(value || '').split('.');
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error('invalid_google_token');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
}

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS google_oauth_connections (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      google_email TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      access_token_enc TEXT,
      access_token_expires_at TIMESTAMPTZ,
      scopes TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS google_oauth_states (
      state_hash TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function tokenRequest(body) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || 'google_token_exchange_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function googleOAuthConfigured() {
  return configured();
}

export async function beginGoogleOAuth(userId) {
  if (!configured()) throw Object.assign(new Error('google_oauth_not_configured'), { status: 503 });
  await ensureSchema();
  const state = crypto.randomBytes(32).toString('base64url');
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  await query('DELETE FROM google_oauth_states WHERE expires_at <= now()');
  await query(
    `INSERT INTO google_oauth_states (state_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 * interval '1 minute'))`,
    [stateHash, userId, STATE_TTL_MINUTES]
  );
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: SCOPES.join(' '),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeGoogleOAuth(code, state) {
  if (!configured()) throw Object.assign(new Error('google_oauth_not_configured'), { status: 503 });
  await ensureSchema();
  const stateHash = crypto.createHash('sha256').update(String(state || '')).digest('hex');
  const { rows } = await query(
    `DELETE FROM google_oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING user_id`,
    [stateHash]
  );
  if (!rows[0]) throw Object.assign(new Error('invalid_or_expired_oauth_state'), { status: 400 });

  const tokens = await tokenRequest({
    code: String(code || ''),
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  if (!tokens.refresh_token) throw Object.assign(new Error('google_refresh_token_missing'), { status: 400 });

  const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await userInfoResponse.json().catch(() => ({}));
  if (!userInfoResponse.ok || !userInfo.email) throw Object.assign(new Error('google_identity_lookup_failed'), { status: 502 });

  await query(
    `INSERT INTO google_oauth_connections
       (user_id, google_email, refresh_token_enc, access_token_enc, access_token_expires_at, scopes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       google_email = EXCLUDED.google_email,
       refresh_token_enc = EXCLUDED.refresh_token_enc,
       access_token_enc = EXCLUDED.access_token_enc,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       scopes = EXCLUDED.scopes,
       updated_at = now()`,
    [
      rows[0].user_id,
      String(userInfo.email).toLowerCase(),
      encrypt(tokens.refresh_token),
      tokens.access_token ? encrypt(tokens.access_token) : null,
      tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null,
      String(tokens.scope || SCOPES.join(' ')),
    ]
  );
  return { userId: rows[0].user_id, email: String(userInfo.email).toLowerCase() };
}

export async function getGoogleConnection(userId) {
  await ensureSchema();
  const { rows } = await query(
    `SELECT google_email, scopes, created_at, updated_at, access_token_expires_at FROM google_oauth_connections WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

export async function disconnectGoogle(userId) {
  await ensureSchema();
  const { rows } = await query('DELETE FROM google_oauth_connections WHERE user_id = $1 RETURNING google_email', [userId]);
  return rows[0] || null;
}

export async function getGoogleAccessToken(userId) {
  await ensureSchema();
  const { rows } = await query('SELECT * FROM google_oauth_connections WHERE user_id = $1', [userId]);
  const connection = rows[0];
  if (!connection) throw Object.assign(new Error('google_account_not_connected'), { status: 404 });

  if (connection.access_token_enc && connection.access_token_expires_at && new Date(connection.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return decrypt(connection.access_token_enc);
  }

  const refreshToken = decrypt(connection.refresh_token_enc);
  const tokens = await tokenRequest({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  await query(
    `UPDATE google_oauth_connections
        SET access_token_enc = $2,
            access_token_expires_at = $3,
            scopes = COALESCE($4, scopes),
            updated_at = now()
      WHERE user_id = $1`,
    [userId, encrypt(tokens.access_token), new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000), tokens.scope || null]
  );
  return tokens.access_token;
}

export const googleScopes = SCOPES;
