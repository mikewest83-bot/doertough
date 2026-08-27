// Product entitlement boundary.
// Billing may retain legacy Stripe plan values for compatibility, but the rest
// of the application should ask whether an account has paid access rather than
// depending on a product-tier name.
//
// Voice configuration was intentionally renamed from the old paid-tier
// variable to VOICE_MINUTES. Keep the already-deployed voice gate compatible
// with that rename while the legacy gate is being removed from the server.
if (!process.env.VOICE_MINUTES_PRO && process.env.VOICE_MINUTES) {
  process.env.VOICE_MINUTES_PRO = process.env.VOICE_MINUTES;
}

import { hasPro } from './db.mjs';

export function hasPaidAccess(user) {
  return hasPro(user);
}
