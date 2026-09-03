# Mike AI iOS API Contract

## Existing backend routes to reuse

### Authentication

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`
- Existing password reset routes

The app should send the authenticated bearer token on API requests and never handle provider secrets.

### Main conversation

- `POST /api/ask`

The iOS client should treat the response as Mike's server-generated answer and should not select an AI provider locally.

### Realtime voice

- `GET /api/speech/token`
- `POST /api/realtime/webrtc-answer`

The existing web client uses an authenticated same-origin proxy for realtime WebRTC negotiation. The iOS implementation should use an equivalent authenticated server bridge rather than exposing an OpenAI realtime secret to the device.

### Vision

- `POST /api/vision/analyze`

Use native camera/photo selection, then upload the image through the authenticated Vision route. Preserve the dedicated Vision model path.

### Deal Finder / resale

Reuse the existing Deal Finder/resale API routes discovered from the production backend rather than duplicating search logic in the app. Facebook Marketplace priority and the existing local resale behavior remain server-side.

### Alerts

Reuse the existing resale/deal alert endpoints. The client should display the server-confirmed cadence and state rather than implementing its own scheduler.

### Account / subscription

The iOS client needs a small server contract for:

- Current Mike entitlement.
- App Store transaction association with the Mike account.
- Mike Months balance/coverage.
- Subscription state and expiration.
- Restore/sync status.

Apple purchase validation and subscription state updates belong on the server.

## iOS-specific server work still required

1. Add a safe endpoint to associate an authenticated Mike account with an App Store transaction/appAccountToken.
2. Add App Store Server Notifications V2 handling.
3. Add App Store Server API verification using Apple's server library.
4. Map Apple subscription products to Mike entitlements.
5. Ensure Apple refunds/cancellations immediately update entitlement state without affecting already-earned Mike Months incorrectly.
6. Add idempotent transaction processing and replay protection.

## Important compatibility rule

Do not replace the existing web Stripe billing implementation while building iOS. Apple billing should be added as a separate entitlement source, allowing web and iPhone customers to be handled cleanly by the same Mike account system.
