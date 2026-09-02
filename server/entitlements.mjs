// Product entitlement boundary.
// Billing may retain legacy Stripe plan values for compatibility, but the rest
// of the application should ask whether an account has paid access rather than
// depending on a product-tier name.
import { hasPro } from './db.mjs';

const OWNER_USER_ID = String(process.env.VOICE_OWNER_USER_ID || '1').trim();

const TESTER_EMAILS = new Set(
  String(process.env.TESTER_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

export function isTester(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return !!email && TESTER_EMAILS.has(email);
}

export function isTrialSubscriber(user) {
  if (!user) return false;
  if (OWNER_USER_ID && String(user.id) === OWNER_USER_ID) return false;
  if (isTester(user)) return false;
  return String(user.subscription_status || '') === 'trialing';
}

export function hasMikeMonthsAccess(user) {
  if (!user?.mike_months_covered_until) return false;
  return new Date(user.mike_months_covered_until) > new Date();
}

export function hasPaidAccess(user) {
  if (!user) return false;
  if (OWNER_USER_ID && String(user.id) === OWNER_USER_ID) return true;
  if (isTester(user)) return true;
  if (hasPro(user)) return true;
  return hasMikeMonthsAccess(user);
}
