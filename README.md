# Mike AI — Doer Tough

Standalone shareable Mike AI app for Railway.

## Architecture
- OpenAI Responses API for text chat and tool use
- OpenAI Realtime over WebRTC for natural voice conversations
- Server-minted short-lived Realtime client secrets
- Account-scoped memory and server-side voice metering
- Stripe Checkout + Billing Portal for subscriptions and trials
- No avatar, lip-sync pipeline, or secondary voice provider

## Railway variables
- `OPENAI_API_KEY` — OpenAI API key
- `OPENAI_MODEL` — optional text model override; defaults to `gpt-4o-mini`
- `OPENAI_REALTIME_MODEL` — optional Realtime model override; defaults to `gpt-realtime-2.1`
- `OPENAI_REALTIME_VOICE` — optional Realtime voice override; defaults to `marin`
- `DATABASE_URL` — Postgres connection
- `JWT_SECRET` — account-session signing secret
- `STRIPE_SECRET_KEY` — Stripe server key
- `STRIPE_PRICE_ID` — Stripe recurring price
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `BILLING_RETURN_URL` — optional billing return URL; defaults to `https://doertoughmikeai.com`
- `TRIAL_DAYS` — optional trial length; defaults to 3

## Voice controls
- `VOICE_MAX_SESSION_SECONDS` — maximum single voice session; defaults to 600
- `VOICE_SESSIONS_PRO` — legacy environment name retained for paid-account session allowance
- `VOICE_SESSIONS_FREE` — free-account session allowance
- `VOICE_SESSIONS_GLOBAL` — global session ceiling
- `VOICE_MINUTES_PRO` — legacy environment name retained for paid-account minute allowance
- `VOICE_MINUTES_FREE` — free-account minute allowance
- `VOICE_MINUTES_GLOBAL` — global minute ceiling

Build: `npm run build`

Start: `npm start`

Mike AI has one production voice path. The browser connects directly to OpenAI Realtime over WebRTC after the server authorizes the session; there is no avatar or secondary voice fallback to compete with that path.
