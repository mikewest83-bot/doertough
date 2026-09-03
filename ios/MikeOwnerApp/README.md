# Mike Owner App — Deal Alerts Phase 1

This directory is the native SwiftUI owner client for the current iOS scope.

## Phase 1 only

- Owner login using the existing Mike account API.
- Owner Deal Alerts list.
- Create a Deal Alert.
- Hourly cadence (`60` minutes) plus the server-supported 5/15/30 minute options.
- Alert detail with server-reported scan/result/error state.
- Stop an alert.
- Bearer token stored in the iOS Keychain.

## Backend

The app talks to:

- `POST /api/auth/login`
- `GET /api/owner/deal-alerts`
- `POST /api/owner/deal-alerts`
- `DELETE /api/owner/deal-alerts/:id`

The owner Deal Alerts routes are added to the feature branch by `scripts/patch-owner-deal-alert-api.mjs` during the normal server build.

## Xcode setup

Create an iOS SwiftUI App target and add the Swift files under `ios/MikeOwnerApp/` to the target. No third-party package is required. The app uses Foundation, Security, Combine, and SwiftUI.

The repository does not contain a generated `.xcodeproj` yet because the current build environment does not have Xcode available to validate a generated project file. Source scaffolding is intentionally kept separate from production.

## Explicitly out of scope

Do not add consumer Chat, Voice, Vision, consumer Deal Finder, avatar functionality, Mike AI Pro branding, or Apple subscription purchase UI in this phase.
