// Product entitlement boundary.
// Billing may retain legacy Stripe plan values for compatibility, but the rest
// of the application should ask whether an account has paid access rather than
// depending on a product-tier name.
import { hasPro } from './db.mjs';

export function hasPaidAccess(user) {
  return hasPro(user);
}
