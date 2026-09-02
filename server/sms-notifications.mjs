// server/sms-notifications.mjs
//
// Text alerts for Mike AI, over Twilio's REST API directly - same pattern as
// mailer.mjs's Resend calls (plain fetch, no SDK, so nothing new has to be
// added to package.json/package-lock.json for the build to pick up).
//
// A phone number is verified before it can receive alerts: subscribing
// saves it unverified and texts a 6-digit code; the number only starts
// receiving deal alerts once that code is confirmed. This exists so a
// mistyped digit doesn't start texting a stranger every time a watch finds
// a deal - the same reasoning as coarsening locations in location-insights.
//
// Disarmed by default, same seam as push-notifications.mjs and mailer.mjs:
// set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either
// TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID to turn it on. Nothing
// about how the app behaves changes until all of those are set.
import crypto from 'node:crypto';
import { query, dbEnabled } from './db.mjs';

const ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
const AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
const FROM_NUMBER = String(process.env.TWILIO_FROM_NUMBER || '').trim();
const MESSAGING_SERVICE_SID = String(process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
const CODE_TTL_MINUTES = 10;

export const smsConfigured = () => dbEnabled && !!ACCOUNT_SID && !!AUTH_TOKEN && (!!FROM_NUMBER || !!MESSAGING_SERVICE_SID);

let schemaReady = null;
async function ensureSmsSchema() {
  if (!schemaReady) {
    schemaReady = query(`
      CREATE TABLE IF NOT EXISTS sms_subscriptions (
        user_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        phone_number       TEXT NOT NULL,
        verified           BOOLEAN NOT NULL DEFAULT false,
        verify_code        TEXT,
        verify_expires_at  TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).catch((error) => {
      schemaReady = null; // let a later call retry rather than wedging
      throw error;
    });
  }
  return schemaReady;
}

// Accepts common US formats (plain 10 digits, with a leading 1, with
// dashes/spaces/parens, or already E.164) and normalizes to E.164. Anything
// that doesn't clearly parse is rejected rather than guessed at - getting
// this wrong means texting the wrong person, not just a display glitch.
export function normalizePhone(value) {
  const raw = String(value || '').trim();
  const digitsAndPlus = raw.replace(/[^\d+]/g, '');
  const digitsOnly = digitsAndPlus.replace(/^\+/, '');
  if (!digitsAndPlus.startsWith('+') && /^1?\d{10}$/.test(digitsOnly)) {
    const ten = digitsOnly.length === 11 ? digitsOnly.slice(1) : digitsOnly;
    return `+1${ten}`;
  }
  if (/^\+[1-9]\d{7,14}$/.test(digitsAndPlus)) return digitsAndPlus;
  return null;
}

async function sendSms(to, body) {
  if (!smsConfigured()) {
    console.warn(`[sms] Twilio not configured - not sending. Would have texted ${to}: ${body}`);
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const params = new URLSearchParams({ To: to, Body: body });
    if (MESSAGING_SERVICE_SID) params.set('MessagingServiceSid', MESSAGING_SERVICE_SID);
    else params.set('From', FROM_NUMBER);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
      signal: AbortSignal.timeout(10000),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.error(`[sms] send failed ${res.status}: ${raw.slice(0, 300)}`);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (error) {
    console.error('[sms] send threw:', error.message || error);
    return { sent: false, reason: 'exception' };
  }
}

// Starts (or restarts) verification for a phone number: saves it unverified
// and texts a fresh 6-digit code. Calling this again before the old code is
// used just replaces it - there is only ever one live code per user.
export async function startPhoneVerification(userId, rawPhone) {
  if (!userId || !smsConfigured() || !(await ensureSmsSchema())) throw new Error('sms_not_configured');
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error('sms_phone_invalid');
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  await query(`
    INSERT INTO sms_subscriptions (user_id, phone_number, verified, verify_code, verify_expires_at, updated_at)
    VALUES ($1,$2,false,$3,$4,now())
    ON CONFLICT (user_id) DO UPDATE SET
      phone_number=EXCLUDED.phone_number, verified=false,
      verify_code=EXCLUDED.verify_code, verify_expires_at=EXCLUDED.verify_expires_at, updated_at=now()
  `, [userId, phone, code, expiresAt]);
  const result = await sendSms(phone, `${code} is your Mike AI verification code. It expires in ${CODE_TTL_MINUTES} minutes.`);
  if (!result.sent) throw new Error('sms_send_failed');
  return { phone };
}

export async function confirmPhoneVerification(userId, rawCode) {
  if (!userId || !(await ensureSmsSchema())) throw new Error('sms_not_configured');
  const code = String(rawCode || '').trim();
  if (!code) throw new Error('sms_code_required');
  const { rows } = await query('SELECT phone_number, verify_code, verify_expires_at FROM sms_subscriptions WHERE user_id=$1', [userId]);
  const row = rows[0];
  if (!row || !row.verify_code) throw new Error('sms_no_pending_code');
  if (new Date(row.verify_expires_at).getTime() < Date.now()) throw new Error('sms_code_expired');
  if (row.verify_code !== code) throw new Error('sms_code_mismatch');
  await query('UPDATE sms_subscriptions SET verified=true, verify_code=NULL, verify_expires_at=NULL, updated_at=now() WHERE user_id=$1', [userId]);
  return { phone: row.phone_number };
}

export async function removePhoneSubscription(userId) {
  if (!userId || !(await ensureSmsSchema())) return false;
  const { rowCount } = await query('DELETE FROM sms_subscriptions WHERE user_id=$1', [userId]);
  return rowCount > 0;
}

// Self-read for the settings UI: masked phone + verified state. Never
// returns the live verification code.
export async function getSmsStatus(userId) {
  if (!userId || !(await ensureSmsSchema())) return { configured: smsConfigured(), subscribed: false };
  const { rows } = await query('SELECT phone_number, verified FROM sms_subscriptions WHERE user_id=$1', [userId]);
  const row = rows[0];
  if (!row) return { configured: smsConfigured(), subscribed: false };
  const masked = row.phone_number.length > 4 ? `••••${row.phone_number.slice(-4)}` : row.phone_number;
  return { configured: smsConfigured(), subscribed: true, verified: row.verified, phoneMasked: masked };
}

// Fire-and-forget alert send, mirroring sendPushToUser's contract: only
// ever texts a verified number, and a missing/unconfigured subscription is
// silently a no-op - this must never throw into a caller that is mid-way
// through emailing/pushing the same alert.
export async function sendSmsToUser(userId, body) {
  if (!userId || !smsConfigured() || !(await ensureSmsSchema())) return { sent: false };
  try {
    const { rows } = await query('SELECT phone_number FROM sms_subscriptions WHERE user_id=$1 AND verified=true', [userId]);
    const row = rows[0];
    if (!row) return { sent: false };
    return await sendSms(row.phone_number, body);
  } catch (error) {
    console.error('[sms] alert send failed:', error?.message || error);
    return { sent: false };
  }
}
