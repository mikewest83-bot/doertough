# Mike AI iOS

Native iPhone client work for Mike AI. This is intentionally a separate client layer; the existing Mike AI backend remains the source of truth for authentication, model routing, tools, usage limits, Vision, Deal Finder, alerts, and account entitlements.

## Current scope

**Phase 1 is focused only on Deal Alerts in the Mike AI owner app.**

Do not build the consumer-facing Chat, Voice, Vision, Deal Finder, or subscription purchase UI yet. Those remain future phases unless explicitly requested.

The first iPhone milestone is an owner-only Deal Alerts control surface that lets the owner:

- View the current deal-alert system state.
- Review alert configuration and cadence.
- Use the existing hourly alert capability.
- Review recent alert/deal activity where the backend exposes it.
- See clear success/error/disabled states.
- Avoid duplicating alert scheduling or search logic on the phone.

## Product rules

- No avatar.
- No Mike AI Pro tier or branding.
- Keep dedicated Deal Alerts on its existing mini model path.
- Keep the alert scheduler and deal-search logic server-side.
- The iOS client is an owner tool for now, not the public Mike AI customer app.
- Production must not be changed just to prototype the iOS owner experience.

## Proposed stack

- Swift + SwiftUI.
- Authenticated HTTPS JSON API calls to the existing Mike backend.
- Native iOS notifications only when they are explicitly needed for the owner experience; the backend remains responsible for alert scheduling.
- No provider/API secrets in the app.

## Initial screens

1. Owner Dashboard — alert system status and latest activity.
2. Deal Alerts — enable/disable, cadence, location/ZIP where supported, and current configuration.
3. Alert Detail — inspect a found deal and the reasoning/data returned by the server.

## Security

- Never embed OpenAI, Anthropic, Stripe, database, or other private keys in the app.
- Authenticate using the existing Mike account/session mechanism.
- Keep model/provider selection server-side.
- Keep alert scheduling server-side.
- Only expose owner-only controls after server-side authorization.

## Next implementation milestone

Build the native owner shell and API client for Deal Alerts first. Then connect the real existing alert endpoints, test hourly cadence/state transitions, and only after that expand the iOS scope.
