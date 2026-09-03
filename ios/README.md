# Mike AI iOS

Native iPhone client for Mike AI. This project is intentionally a separate client layer: the existing Mike AI backend remains the source of truth for authentication, model routing, tools, usage limits, Vision, Deal Finder, alerts, and account entitlements.

## Product goals

- Fast, conversational Mike experience with voice first-class.
- Chat, voice, Vision, Deal Finder, and alerts in one native app.
- No avatar.
- No Mike AI Pro tier or branding.
- 7-day free trial as the current product requirement.
- Dedicated Vision and Deal Alerts paths remain on their existing mini model routes.
- Main conversational Mike continues using GPT-5.6 Luna with existing routing/escalation behavior.
- Present OpenAI + Anthropic as a customer benefit without implying every request uses both providers.

## Proposed stack

- Swift + SwiftUI for the app UI.
- StoreKit 2 for App Store subscriptions and trial presentation.
- App Store Server API + App Store Server Notifications for server-side subscription truth.
- Native camera/photo picker for Vision.
- Native microphone/audio session and the existing Mike realtime backend bridge for voice.
- HTTPS JSON APIs for authenticated chat, Vision, Deal Finder, alerts, and account operations.

## Initial screens

1. Home — one-tap Talk, Chat, Show Mike, Find a Deal.
2. Conversation — text and voice with smooth turn-taking.
3. Vision — capture/select a photo and analyze it with Mike Vision.
4. Deal Finder — search and inspect resale opportunities.
5. Alerts — manage deal alerts, including hourly cadence where eligible.
6. Account — profile, entitlement, Mike Months, subscription management, restore purchases, and sign out.

## Security rules

- Never embed OpenAI, Anthropic, Stripe, database, or App Store private keys in the app.
- Authenticate API calls with the existing Mike account token/session mechanism.
- Keep provider/model selection server-side.
- Treat the server as the entitlement source of truth for cross-platform access.
- Validate Apple transactions server-side before granting subscription access.

## First implementation milestone

Build the native shell and API client first, then wire chat. Voice, Vision, Deal Finder, alerts, and StoreKit follow as isolated feature modules. Do not change production while the iOS client is being built.
