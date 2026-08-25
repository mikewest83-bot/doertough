// server/auth.mjs
//
// Email + password accounts for Mike AI, matching DoerToughMoney's shape
// (bcrypt hash, JWT bearer token, same publicUser fields) so the two can be
// merged onto one account system later without a rewrite. Email is the
// identity key in both.
//
// Deliberately NOT included yet: Google sign-in and passkeys. Both exist in
// DoerToughMoney and can be ported once this is proven.
//
// Env:
//   JWT_SECRET   REQUIRED. Long random string. Changing it logs everyone out.
//   OWNER_EMAIL  Optional. The account treated as the owner (see isOwner).

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  dbEnabled,
  createUser,
  getUserByEmail,
  getUserById,
  touchUser,
  hasPro,
} from './db.mjs';

const JWT_SECRET = process.env.JWT_SECRET || '';
const TOKEN_TTL = '30d';

const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();

export const authConfigured = () => dbEnabled && !!JWT_SECRET;

const sign = (user) => jwt.sign({ uid: String(user.id) }, JWT_SECRET, { expiresIn: TOKEN_TTL });

// What the browser is allowed to know about an account. Subscription state is
// included so the UI can show the right button, but it is only ever READ here
// - the Stripe webhook is the only thing that writes it.
export const publicUser = (u) => ({
  id: String(u.id),
  name: u.name,
  email: u.email,
  isOwner: isOwner(u),
  plan: u.plan || 'free',
  isPro: hasPro(u),
  subscriptionStatus: u.subscription_status || null,
  currentPeriodEnd: u.current_period_end || null,
  hasBillingAccount: !!u.stripe_customer_id,
});

// The owner is the single account allowed to see Mike's own business data.
// Everyone else gets the public Mike. If OWNER_EMAIL is unset, nobody is the
// owner - that fails closed, which is the safe direction.
export function isOwner(user) {
  if (!user || !OWNER_EMAIL) return false;
  return String(user.email || '').trim().toLowerCase() === OWNER_EMAIL;
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

// Deliberately loose - real validation is "did the signup succeed", not a regex.
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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

    if (!cleanName || !cleanEmail || !password) {
      return res.status(400).json({ error: 'Name, email, and password are all required.' });
    }
    if (!looksLikeEmail(cleanEmail)) {
      return res.status(400).json({ error: 'That does not look like an email address.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    }
    if (cleanName.length > 80 || cleanEmail.length > 254) {
      return res.status(400).json({ error: 'Name or email is too long.' });
    }
    if (String(password).length > 200) {
      return res.status(400).json({ error: 'That password is too long.' });
    }

    if (await getUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: 'That email is already registered.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await createUser({ email: cleanEmail, name: cleanName, passwordHash });

    // Log the account creation without printing the address itself.
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

    // Same message whether the email is unknown or the password is wrong -
    // otherwise this endpoint tells strangers which emails have accounts.
    const reject = () => res.status(401).json({ error: 'No account matches those details.' });

    if (!user || !user.password_hash) return reject();

    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) return reject();

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

async function userFromRequest(req) {
  if (!authConfigured()) return null;

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  try {
    const { uid } = jwt.verify(token, JWT_SECRET);
    return await getUserById(uid);
  } catch {
    return null;
  }
}

// Hard gate: 401 if there is no valid session.
export async function authRequired(req, res, next) {
  // optionalAuth runs app-wide before the guard, so req.user is usually
  // already resolved by the time we get here.
  const user = req.user || (await userFromRequest(req));
  if (!user) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  req.user = user;
  next();
}

// Soft gate: attaches req.user when signed in, and lets anonymous visitors
// straight through. This is what /api/ask uses - Mike stays public, and a
// signed-in visitor simply gets more.
export async function optionalAuth(req, res, next) {
  try {
    if (!req.user) req.user = await userFromRequest(req);
  } catch {
    req.user = null;
  }
  next();
}
