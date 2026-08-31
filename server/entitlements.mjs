// Product entitlement boundary.
// Billing may retain legacy Stripe plan values for compatibility, but the rest
// of the application should ask whether an account has paid access rather than
// depending on a product-tier name.
//
// Voice configuration uses VOICE_MINUTES. The owner account is granted the
// paid/testing allowance server-side so voice testing does not depend on a
// Stripe subscription or a retired product tier.
import { hasPro } from './db.mjs';

// The first database account is the original owner/test account. This fallback
// keeps the owner voice allowance working even if OWNER_EMAIL is unavailable
// in a deployment. A deployment may override it explicitly with
// VOICE_OWNER_USER_ID.
const OWNER_USER_ID = String(process.env.VOICE_OWNER_USER_ID || '1').trim();

// Testing group. Accounts whose email is listed in TESTER_EMAILS (comma
// separated) are granted the same access as a paid account, server-side, with
// no Stripe subscription and no trial - so a test group can use the full
// product without entering a card. This is read only from the environment;
// nothing the browser sends can add an account to it. With TESTER_EMAILS
// unset the set is empty and behaviour is exactly as before.
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

// A trial granted by Stripe is paid access, but it is not a paying customer.
// The voice allowance is the expensive part of the product, so trials get
// their own smaller budget: an account is only "trialing" here if its access
// comes from a Stripe trial, never the owner or an allowlisted tester, who
// keep the full paid allowance.
export function isTrialSubscriber(user) {
  if (!user) return false;
  if (OWNER_USER_ID && String(user.id) === OWNER_USER_ID) return false;
  if (isTester(user)) return false;
  return String(user.subscription_status || '') === 'trialing';
}

export function hasPaidAccess(user) {
  if (!user) return false;
  if (OWNER_USER_ID && String(user.id) === OWNER_USER_ID) return true;
  if (isTester(user)) return true;
  return hasPro(user);
}
