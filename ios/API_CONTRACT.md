# Mike AI iOS Deal Alerts API Contract

## Scope

Phase 1 of the iPhone work is **owner-only Deal Alerts**. The app must reuse the existing Mike backend and must not implement alert search, ranking, scheduling, or model selection locally.

## Existing backend capabilities to reuse

The iOS owner client should call the existing authenticated Deal Alerts/resale endpoints already used by Mike AI. The server remains responsible for:

- Deal discovery and search.
- Local resale logic and Facebook Marketplace priority.
- Deal ranking/analysis.
- Alert scheduling, including the hourly cadence.
- Alert persistence and delivery state.
- Model/provider routing, including the dedicated Deal Alerts mini path.

The exact endpoint names should be taken from the current server implementation rather than invented in the iOS client.

## Owner authentication

- Use the existing Mike account authentication/session mechanism.
- Require server-side owner authorization for every owner-only alert operation.
- Never put provider or database secrets in the app.

## Owner UI data contract

The client should be able to display, when available from the backend:

- Alert enabled/disabled state.
- Current cadence/frequency.
- Current location/ZIP configuration.
- Last successful scan/run.
- Last alert/deal result.
- Recent alert activity.
- Error/paused state and a human-readable reason.

The app should treat server responses as authoritative and should not infer scheduler state from local timers.

## Hourly alerts

The existing hourly alert option must be represented as a server-confirmed cadence. The iPhone app should request the cadence change and then refresh the server state. It must not create a second hourly timer on the device.

## Notifications

If native iOS notifications are added, they should mirror server-confirmed alert events. Notification delivery must not become a second source of truth for whether an alert ran.

## Future expansion

Chat, Voice, Vision, consumer Deal Finder, and Apple subscription billing are intentionally out of Phase 1. Their API contracts should not be added to the owner Deal Alerts client until the scope is expanded.
