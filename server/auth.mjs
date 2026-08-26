// server/auth.mjs
// Email + password accounts for Mike AI.

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  dbEnabled,
  createUser,
  getUserByEmail,
  getUserById,
  touchUser,
  createPasswordReset,
  findPasswordReset,
  consumePasswordReset,
} from './db.mjs';
import { sendPasswordReset } from './mailer.mjs';

const JWT_SECRET = process.env.JWT_SECRET || '';
const TOKEN_TTL = '30d';
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60);
const RESET_BASE_URL = String(process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com').replace(/\/+$/, '');

export const authConfigured = () => dbEnabled && !!JWT_SECRET;

const sign = (user) => jwt.sign(
  { uid: String(user.id), tv: Number(user.token_version || 0) },
  JWT_SECRET,
  { expiresIn: TOKEN_TTL }
);

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Only expose account information Mike's browser actually needs.
export const publicUser = (u) => ({
  id: String(u.id),
  name: u.name,
  email: u.email,
  isOwner: isOwner(u),
});

// The owner is the single account allowed to see Mike's own business data.
// If OWNER_EMAIL is unset, nobody is the owner - fail closed.
export function isOwner(user) {
  if (!user || !OWNER_EMAIL) return false;
  return normalizeEmail(user.email) === OWNER_EMAIL;
}

function guard(res) {
  if (!dbEnabled) {
    res.status(503).json({ error: 'Accounts are not set up on this server yet.' });
    return false;
  }
  if (!JWT_SECRET) {
    console.error('[auth] JWT_SECRET is not set - refusing to issue tokens');
    res.status(503).json({ error: 'Accounts are not set up on this server yet.' });
    return false;
  }
  return true;
}

export async function register(req, res) {
  if (!guard(res)) return;
  try {
    const { name, email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);
    const cleanName = String(name || '').trim();

    if (!cleanName || !cleanEmail || !password) return res.status(400).json({ error: 'Name, email, and password are all required.' });
    if (!looksLikeEmail(cleanEmail)) return res.status(400).json({ error: 'That does not look like an email address.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    if (cleanName.length > 80 || cleanEmail.length > 254) return res.status(400).json({ error: 'Name or email is too long.' });
    if (String(password).length > 200) return res.status(400).json({ error: 'That password is too long.' });
    if (await getUserByEmail(cleanEmail)) return res.status(409).json({ error: 'That email is already registered.' });

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await createUser({ email: cleanEmail, name: cleanName, passwordHash });
    console.log(`[auth] new account #${user.id}`);
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth] register failed:', err.message || err);
    res.status(500).json({ error: 'Could not create that account. Try again.' });
  }
}

export async function login(req, res) {
  if (!guard(res)) return;
  try {
    const { email, password } = req.body || {};
    const user = await getUserByEmail(email);
    const reject = () => res.status(401).json({ error: 'No account matches those details.' });
    if (!user || !user.password_hash) return reject();
    if (!(await bcrypt.compare(String(password || ''), user.password_hash))) return reject();
    await touchUser(user.id);
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth] login failed:', err.message || err);
    res.status(500).json({ error: 'Could not sign you in. Try again.' });
  }
}

export async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

export async function requestPasswordReset(req, res) {
  if (!guard(res)) return;
  const ok = () => res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !looksLikeEmail(email)) return ok();
    const user = await getUserByEmail(email);
    if (!user) return ok();

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);
    await createPasswordReset(user.id, hashToken(token), expiresAt);
    const resetUrl = `${RESET_BASE_URL}/?reset=${encodeURIComponent(token)}`;
    await sendPasswordReset({ to: user.email, name: user.name, resetUrl, expiresMinutes: RESET_TTL_MINUTES });
    console.log(`[auth] reset link issued for account #${user.id}`);
    return ok();
  } catch (err) {
    console.error('[auth] reset request failed:', err.message || err);
    return ok();
  }
}

export async function resetPassword(req, res) {
  if (!guard(res)) return;
  try {
    const { token, password } = req.body || {};
    if (!token) return res.status(400).json({ error: 'That reset link is not valid.' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    if (String(password).length > 200) return res.status(400).json({ error: 'That password is too long.' });

    const ticket = await findPasswordReset(hashToken(token));
    if (!ticket) return res.status(400).json({ error: 'That reset link has expired or already been used. Request a new one.' });

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await consumePasswordReset(ticket.id, ticket.user_id, passwordHash);
    if (!user) return res.status(400).json({ error: 'That reset link has already been used.' });

    console.log(`[auth] password reset completed for account #${user.id}`);
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (err) {
    console.error('[auth] reset failed:', err.message || err);
    res.status(500).json({ error: 'Could not reset that password. Try again.' });
  }
}

async function userFromRequest(req) {
  if (!authConfigured()) return null;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try {
    const { uid, tv } = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(uid);
    if (!user) return null;
    if (Number(tv || 0) !== Number(user.token_version || 0)) return null;
    return user;
  } catch {
    return null;
  }
}

export async function authRequired(req, res, next) {
  const user = req.user || (await userFromRequest(req));
  if (!user) return res.status(401).json({ error: 'Sign in to continue.' });
  req.user = user;
  next();
}

export async function optionalAuth(req, res, next) {
  try {
    if (!req.user) req.user = await userFromRequest(req);
  } catch {
    req.user = null;
  }
  next();
}
