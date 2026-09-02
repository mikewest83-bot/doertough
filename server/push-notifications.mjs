import crypto from 'node:crypto';
import webpush from 'web-push';
import { query, dbEnabled } from './db.mjs';

const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const base64url = (value) => Buffer.from(value).toString('base64url');

function deriveVapidIdentity() {
  const explicitPrivate = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const explicitPublic = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  if (explicitPrivate && explicitPublic) return { privateKey: explicitPrivate, publicKey: explicitPublic };

  const seed = String(process.env.MIKE_PUSH_SEED || process.env.JWT_SECRET || process.env.AUTH_SECRET || process.env.DATABASE_URL || process.env.OPENAI_API_KEY || '').trim();
  if (!seed) return { privateKey: '', publicKey: '' };

  const digest = crypto.createHash('sha256').update(`doertough-mike-push-v1:${seed}`).digest();
  const scalar = (BigInt(`0x${digest.toString('hex')}`) % (P256_ORDER - 1n)) + 1n;
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privateBytes);
  return { privateKey: base64url(privateBytes), publicKey: base64url(ecdh.getPublicKey(null, 'uncompressed')) };
}

const vapid = deriveVapidIdentity();
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@doertough.com';
const configured = Boolean(vapid.privateKey && vapid.publicKey && dbEnabled);
if (configured) webpush.setVapidDetails(vapidSubject, vapid.publicKey, vapid.privateKey);

let schemaReady = false;

export function pushConfigured() {
  return configured;
}

export function pushPublicKey() {
  return configured ? vapid.publicKey : '';
}

export async function ensurePushSchema() {
  if (!dbEnabled || schemaReady) return dbEnabled;
  await query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id, updated_at DESC);
  `);
  schemaReady = true;
  return true;
}

function validSubscription(value) {
  return Boolean(value && typeof value === 'object' && typeof value.endpoint === 'string' && value.endpoint.startsWith('https://') && value.keys && typeof value.keys.p256dh === 'string' && typeof value.keys.auth === 'string');
}

export async function savePushSubscription(userId, subscription) {
  if (!userId || !pushConfigured() || !(await ensurePushSchema())) throw new Error('push_not_configured');
  if (!validSubscription(subscription)) throw new Error('push_subscription_invalid');
  await query(`
    INSERT INTO push_subscriptions (user_id, endpoint, subscription)
    VALUES ($1,$2,$3::jsonb)
    ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, subscription=EXCLUDED.subscription, updated_at=now()
  `, [userId, subscription.endpoint, JSON.stringify(subscription)]);
  return true;
}

export async function removePushSubscription(userId, endpoint) {
  if (!userId || !(await ensurePushSchema())) return false;
  const { rowCount } = await query('DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2', [userId, endpoint]);
  return rowCount > 0;
}

function notificationPayload({ title, body, url, tag }) {
  return JSON.stringify({ title: String(title || 'Mike found something'), body: String(body || ''), url: String(url || '/'), tag: String(tag || 'mike-alert'), icon: '/mike-icon.svg', badge: '/mike-icon.svg' });
}

export async function sendPushToUser(userId, payload) {
  if (!pushConfigured() || !userId || !(await ensurePushSchema())) return { sent: 0, removed: 0 };
  const { rows } = await query('SELECT id, endpoint, subscription FROM push_subscriptions WHERE user_id=$1', [userId]);
  let sent = 0;
  let removed = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(row.subscription, notificationPayload(payload), { TTL: 86400 });
      sent += 1;
    } catch (error) {
      const status = Number(error?.statusCode);
      if (status === 404 || status === 410) {
        await query('DELETE FROM push_subscriptions WHERE id=$1', [row.id]);
        removed += 1;
      } else console.warn(`[push] delivery failed for subscription #${row.id}: ${error?.message || error}`);
    }
  }
  return { sent, removed };
}

export async function pushSubscribeHandler(req, res) {
  try { await savePushSubscription(req.user.id, req.body?.subscription); res.json({ ok: true }); }
  catch (error) { res.status(error.message === 'push_not_configured' ? 503 : 400).json({ error: error.message || 'push_subscription_failed' }); }
}

export async function pushUnsubscribeHandler(req, res) {
  try {
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'push_endpoint_required' });
    await removePushSubscription(req.user.id, endpoint);
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message || 'push_unsubscribe_failed' }); }
}
