# Mike AI — Doer Tough

Standalone shareable Mike AI app for Railway.

## Railway variables
- `OPENAI_API_KEY` — OpenAI API key
- `ELEVENLABS_API_KEY` — ElevenLabs API key
- `ELEVENLABS_VOICE_ID` — optional; defaults to Mike's configured voice
- `FAL_KEY` — fal.ai key for talking-avatar lip sync
- `MIKE_SOURCE_VIDEO_URL` — optional; defaults to the existing Mike source video
- `OPENAI_MODEL` — optional; defaults to `gpt-5.4-mini`

Build: `npm run build`  Start: `npm start`

The app intentionally falls back to the static Mike image and browser speech if a paid voice/avatar provider is unavailable, so Mike never disappears.