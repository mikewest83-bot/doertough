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

export function hasPaidAccess(user) {
  if (!user) return false;
  if (OWNER_USER_ID && String(user.id) === OWNER_USER_ID) return true;
  return hasPro(user);
}
