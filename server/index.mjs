import express from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { fal } from '@fal-ai/client';
import { LIVE_TOOLS as BASE_TOOLS, LIVE_TOOL_HANDLERS as BASE_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { FREE_TOOLS, FREE_TOOL_HANDLERS } from './free-tools.mjs';
import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';
import { installGuards } from './guard.mjs';
import { MIKE_INSTRUCTIONS } from './persona.mjs';
import {
  migrate,
  hasPro,
  recordVoiceSession,
  closeVoiceSession,
  countVoiceSessions,
  countVoiceSessionsGlobal,
  countVoiceSeconds,
  countVoiceSecondsGlobal,
} from './db.mjs';
import {
  createCheckoutSession,
  createPortalSession,
  billingConfigured,
  hasActiveSubscription,
} from './billing.mjs';
import { initializeSpeechEngine, getSpeechEngineToken } from './speech-engine.mjs';
import {
  verifyStripeSignature,
  stripeWebhookConfigured,
  handleStripeWebhook,
} from './stripe-webhook.mjs';
import {
  register,
  login,
  me,
  authRequired,
  optionalAuth,
  isOwner,
  authConfigured,
} from './auth.mjs';

const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS];
const LIVE_TOOL_HANDLERS = {
  ...BASE_HANDLERS,
  ...BUSINESS_TOOL_HANDLERS,
  ...FREE_TOOL_HANDLERS,
  ...FIELD_TOOL_HANDLERS,
};

// Tools that read Mike's OWN business data. Everyone else gets the public
// Mike. These are filtered out of the tool list entirely for non-owners, so
// the model never even sees that they exist.
const OWNER_ONLY_TOOLS = new Set(['get_store_sales', 'get_bot_status', 'get_btc_rsi']);

const PUBLIC_TOOLS = LIVE_TOOLS.filter((t) => !OWNER_ONLY_TOOLS.has(t.name));

const NON_OWNER_NOTE =
  '\n\nTOOL AVAILABILITY FOR THIS CONVERSATION\n' +
  'You are talking with a visitor, not Mike. The store-sales and trading-account ' +
  'tools are not available in this conversation and you cannot see those numbers. ' +
  'If asked about Doer Tough revenue, order counts, or the trading account balance, ' +
  'say plainly that those are Mike\'s own private business numbers and you do not ' +
  'share them. Do not guess, estimate, or invent any figure. Everything else you ' +
  'know about the portfolio is fair game.';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ===== Config =====
const PREVIEW_VIDEO =
  process.env.MIKE_PREVIEW_VIDEO_URL ||
  process.env.MIKE_SOURCE_VIDEO_URL ||
  'https://resource2.heygen.ai/avatar/v3/faea73f9ba464fa1983039c3f2052414/half/2.2/preview_video_target.mp4';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const FAL_MODEL = process.env.FAL_LIPSYNC_MODEL || 'veed/lipsync/v2';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

if (process.env.FAL_KEY) {
  fal.config({ credentials: process.env.FAL_KEY });
}

app.disable('x-powered-by');

// ===== Stripe webhook =====
// This MUST be registered before express.json(). Stripe signs the exact
// bytes it sent; once the JSON parser replaces req.body with an object the
// raw payload is gone and every signature check fails. express.raw() is
// scoped to this one path, so the rest of the app still gets parsed JSON.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripeWebhookConfigured()) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET is not set — rejecting webhook.');
    return res.status(503).json({ error: 'stripe_webhook_not_configured' });
  }

  if (!Buffer.isBuffer(req.body)) {
    // Only happens if a body parser sneaks in above this route.
    console.error('[stripe] raw body unavailable — express.raw() did not run first.');
    return res.status(500).json({ error: 'raw_body_unavailable' });
  }

  const rawBody = req.body.toString('utf8');
  const ok = verifyStripeSignature(
    rawBody,
    req.get('stripe-signature'),
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (!ok) {
    console.warn('[stripe] signature verification failed');
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // Acknowledge before doing the work. Stripe times out at 20s and retries
  // any non-2xx; a slow handler turns into duplicate deliveries.
  res.json({ received: true });

  try {
    await handleStripeWebhook(event);
  } catch (err) {
    console.error('[stripe] handler error:', err);
  }
});

app.use(express.json({ limit: '15mb' }));

// Resolve the signed-in user before the guard runs, so rate limits key on the
// account rather than the IP. optionalAuth never rejects.
app.use(optionalAuth);
installGuards(app);

// ===== Accounts =====
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/auth/me', authRequired, me);

// ===== Helpers =====
const requireKey = (key, name) => {
  if (!key) {
    const err = new Error(`${name}_not_configured`);
    err.status = 503;
    throw err;
  }
};

let cachedVoiceId = null;

async function resolveMikeVoice() {
  if (process.env.ELEVENLABS_VOICE_ID) {
    return process.env.ELEVENLABS_VOICE_ID;
  }
  if (cachedVoiceId) return cachedVoiceId;

  requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');

  const res = await fetch(
    'https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=non-default',
    {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    }
  );

  if (!res.ok) {
    throw new Error(`elevenlabs_voice_list_${res.status}`);
  }

  const data = await res.json();
  const voices = data.voices || [];

  const ranked = voices
    .map((v) => {
      const text = `${v.name || ''} ${v.description || ''} ${JSON.stringify(v.labels || {})}`.toLowerCase();
      let score = 0;
      if (/mike/.test(text)) score += 100;
      if (/diesel|bin/.test(text)) score += 80;
      if (/doer|tough/.test(text)) score += 60;
      if (/southern|country|texas|american/.test(text)) score += 25;
      if (['personal', 'cloned', 'generated'].includes(v.category) || v.voice_type === 'personal') {
        score += 20;
      }
      return { voice: v, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    throw new Error('elevenlabs_no_suitable_voice');
  }

  cachedVoiceId = ranked[0].voice.voice_id;
  console.log(`[voice] selected: ${ranked[0].voice.name} (${cachedVoiceId})`);
  return cachedVoiceId;
}

// ===== Realtime voice =====
//
// Every token handed out here is a billable ElevenLabs conversation, and the
// plan's agent minutes are a single pool for the WHOLE site. Three gates:
// you need an account, your plan has a monthly budget, and a global ceiling
// stops one busy day draining the month for everyone.
//
// Env: VOICE_SESSIONS_PRO (40) · VOICE_SESSIONS_FREE (1) · VOICE_SESSIONS_GLOBAL (120)
const VOICE_SESSIONS_PRO = Number(process.env.VOICE_SESSIONS_PRO || 40);
const VOICE_SESSIONS_FREE = Number(process.env.VOICE_SESSIONS_FREE || 1);
const VOICE_SESSIONS_GLOBAL = Number(process.env.VOICE_SESSIONS_GLOBAL || 120);

// MINUTE budget - the one that actually tracks the bill, since ElevenLabs
// charges per minute and a session count can't tell a 20-second chat from a
// 10-minute one. Both budgets apply; whichever runs out first stops the
// session. Keep MAX_SESSION_SECONDS equal to the engine's own
// max_duration_seconds in speech-engine.mjs, or the reservation under-charges.
//
// Env: VOICE_MINUTES_PRO (200) · VOICE_MINUTES_FREE (10) · VOICE_MINUTES_GLOBAL (5000)
const MAX_SESSION_SECONDS = Number(process.env.VOICE_MAX_SESSION_SECONDS || 600);
const VOICE_MINUTES_PRO = Number(process.env.VOICE_MINUTES_PRO || 200);
const VOICE_MINUTES_FREE = Number(process.env.VOICE_MINUTES_FREE || 10);
const VOICE_MINUTES_GLOBAL = Number(process.env.VOICE_MINUTES_GLOBAL || 5000);

app.get('/api/speech/token', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'sign_in_required',
        message: 'Sign in to talk with Mike.',
      });
    }

    const pro = hasPro(req.user);
    const outOfBudget = () =>
      res.status(402).json({
        error: pro ? 'voice_allowance_reached' : 'upgrade_required',
        message: pro
          ? "You've used this month's voice time. It resets on a rolling 30-day window."
          : 'Start your free trial to talk with Mike.',
      });

    // Gate 1: session count.
    const allowance = pro ? VOICE_SESSIONS_PRO : VOICE_SESSIONS_FREE;
    const used = await countVoiceSessions(req.user.id);
    if (used >= allowance) return outOfBudget();

    // Gate 2: minutes. There has to be room for a FULL session, not a
    // sliver - otherwise someone with 30 seconds left starts a call that
    // runs ten minutes and overshoots the budget anyway.
    const secondsAllowance = (pro ? VOICE_MINUTES_PRO : VOICE_MINUTES_FREE) * 60;
    const secondsUsed = await countVoiceSeconds(req.user.id);
    if (secondsUsed + MAX_SESSION_SECONDS > secondsAllowance) {
      console.log(
        `[speech-engine] account #${req.user.id} out of minutes ` +
          `(${Math.round(secondsUsed / 60)}/${secondsAllowance / 60})`
      );
      return outOfBudget();
    }

    // Gate 3: the workspace-wide pool, on both units.
    const globalUsed = await countVoiceSessionsGlobal();
    const globalSeconds = await countVoiceSecondsGlobal();
    if (
      globalUsed >= VOICE_SESSIONS_GLOBAL ||
      globalSeconds + MAX_SESSION_SECONDS > VOICE_MINUTES_GLOBAL * 60
    ) {
      console.error(
        `[speech-engine] global ceiling hit - ${globalUsed} sessions, ` +
          `${Math.round(globalSeconds / 60)} minutes`
      );
      return res.status(503).json({
        error: 'voice_capacity_reached',
        message: 'Mike is at capacity right now. Try again a bit later.',
      });
    }

    const result = await getSpeechEngineToken();

    // Charge the worst case now. The client hands the key back on hangup to
    // settle it down to the real duration; if it never does, the full
    // reservation stands.
    const sessionKey = crypto.randomUUID();
    await recordVoiceSession(req.user.id, result.agentId, {
      sessionKey,
      reservedSeconds: MAX_SESSION_SECONDS,
    });

    res.json({
      ...result,
      sessionKey,
      maxSessionSeconds: MAX_SESSION_SECONDS,
      minutesRemaining: Math.max(0, Math.floor((secondsAllowance - secondsUsed) / 60)),
    });
  } catch (err) {
    console.error('[speech-engine] token failed:', err.message || err);
    res.status(err.status || 502).json({ error: err.message || 'speech_engine_unavailable' });
  }
});

// Settle a finished voice session. The browser posts the real duration when
// the call ends, which releases the unused part of the reservation.
//
// This trusts the client to report honestly, which is fine because it can
// only ever REDUCE its own allowance usage below the worst case already
// charged - and the session-count gate still applies in parallel, so
// under-reporting cannot buy unlimited calls. The value is clamped to one
// session's maximum and the update is single-use.
app.post('/api/speech/session-end', authRequired, async (req, res) => {
  try {
    const sessionKey = String(req.body?.sessionKey || '').trim();
    if (!sessionKey) return res.status(400).json({ error: 'session_key_required' });

    const reported = Number(req.body?.seconds);
    if (!Number.isFinite(reported) || reported < 0) {
      return res.status(400).json({ error: 'seconds_invalid' });
    }

    const seconds = Math.min(Math.round(reported), MAX_SESSION_SECONDS);
    const row = await closeVoiceSession(sessionKey, req.user.id, seconds);

    if (!row) {
      // Unknown key, someone else's session, or already settled. Not an
      // error worth surfacing - the reservation simply stands.
      return res.json({ settled: false });
    }

    console.log(`[speech-engine] session settled: ${seconds}s for account #${req.user.id}`);
    res.json({ settled: true, seconds });
  } catch (err) {
    console.error('[speech-engine] settle failed:', err.message || err);
    res.status(500).json({ error: 'settle_failed' });
  }
});

// ===== Billing =====
// Checkout is created here rather than linked to directly, so the session
// carries client_reference_id and the webhook can grant Pro to the account
// that actually paid.
app.post('/api/billing/checkout', authRequired, async (req, res) => {
  try {
    // An account that already subscribes gets the management portal, not a
    // second checkout. Handing back a portal URL under the same `url` key
    // means an older client that just follows `url` still does the right
    // thing rather than erroring.
    if (hasActiveSubscription(req.user)) {
      console.log(`[billing] account #${req.user.id} already subscribed - routing to portal`);
      const portal = await createPortalSession(req.user);
      return res.json({
        ...portal,
        alreadySubscribed: true,
        message: 'You already have Mike AI Pro. This opens your billing settings.',
      });
    }
    res.json(await createCheckoutSession(req.user));
  } catch (err) {
    console.error('[billing] checkout failed:', err.message || err);
    res.status(err.status || 502).json({ error: err.message || 'checkout_unavailable' });
  }
});

app.post('/api/billing/portal', authRequired, async (req, res) => {
  try {
    res.json(await createPortalSession(req.user));
  } catch (err) {
    console.error('[billing] portal failed:', err.message || err);
    res.status(err.status || 502).json({ error: err.message || 'portal_unavailable' });
  }
});

// ===== Client-side error reporting =====
// The realtime voice session fails inside the browser, on the leg between the
// client and ElevenLabs' LiveKit host — a failure the server never observes.
// The client posts the raw error here so it lands in the deploy log next to
// everything else instead of only in a console nobody has open.
app.post('/api/client-log', (req, res) => {
  const detail = {
    phase: String(req.body?.phase || 'unknown').slice(0, 60),
    name: String(req.body?.name || '').slice(0, 120),
    message: String(req.body?.message || '').slice(0, 600),
    extra: String(req.body?.extra || '').slice(0, 900),
    ua: String(req.get('user-agent') || '').slice(0, 200),
  };
  console.error(`[client] ${detail.phase}: ${detail.name || 'Error'}: ${detail.message}`);
  if (detail.extra) console.error(`[client] ${detail.phase} detail: ${detail.extra}`);
  console.error(`[client] ${detail.phase} ua: ${detail.ua}`);
  res.json({ logged: true });
});

// ===== Routes =====

// Health
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'mike-ai',
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    voiceConfigured: !!process.env.ELEVENLABS_API_KEY,
    lipSyncConfigured: !!process.env.FAL_KEY,
    liveAvatarConfigured: !!process.env.LIVEAVATAR_API_KEY && !!process.env.LIVEAVATAR_AVATAR_ID,
    liveToolsConfigured: true,
    toolCount: LIVE_TOOLS.length,
    voiceBudget: {
      maxSessionSeconds: MAX_SESSION_SECONDS,
      proMinutes: VOICE_MINUTES_PRO,
      freeMinutes: VOICE_MINUTES_FREE,
      globalMinutes: VOICE_MINUTES_GLOBAL,
      proSessions: VOICE_SESSIONS_PRO,
      globalSessions: VOICE_SESSIONS_GLOBAL,
    },
    accountsConfigured: authConfigured(),
    billingConfigured: billingConfigured(),
    model: OPENAI_MODEL,
    timestamp: new Date().toISOString(),
  });
});

// ===== LiveAvatar (real-time streaming avatar) =====
// Routes live under /api/liveavatar/* on purpose: /api/avatar/:id below is the
// fal lip-sync poller and would otherwise swallow these paths.
const LA_KEY = process.env.LIVEAVATAR_API_KEY || '';
const LA_AVATAR = process.env.LIVEAVATAR_AVATAR_ID || '';
const LA_VOICE = process.env.LIVEAVATAR_VOICE_ID || '';
const LA_SANDBOX = String(process.env.LIVEAVATAR_SANDBOX || '') === 'true';

async function mintLiveAvatarToken() {
  requireKey(LA_KEY, 'liveavatar');
  if (!LA_AVATAR) {
    const err = new Error('liveavatar_avatar_id_not_configured');
    err.status = 503;
    throw err;
  }

  const body = {
    avatar_id: LA_AVATAR,
    mode: 'FULL',
    is_sandbox: LA_SANDBOX,
    video_settings: { quality: 'high', encoding: 'H264' },
    avatar_persona: {
      language: 'en',
      ...(LA_VOICE ? { voice_id: LA_VOICE } : {}),
    },
  };

  const res = await fetch('https://api.liveavatar.com/v1/sessions/token', {
    method: 'POST',
    headers: { 'X-API-KEY': LA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    // leave data empty; raw is surfaced in the error below
  }

  const token = data?.data?.session_token || data?.data?.token || null;

  if (!res.ok || !token) {
    const err = new Error(
      `liveavatar_token_${res.status}: ${(data?.message || raw || 'no session_token in response').slice(0, 300)}`
    );
    err.status = 502;
    throw err;
  }

  return token;
}

// Mints a session token for the browser. The API key never leaves the server.
app.post('/api/liveavatar/session', async (req, res) => {
  try {
    const token = await mintLiveAvatarToken();
    res.json({ token, avatarId: LA_AVATAR, sandbox: LA_SANDBOX });
  } catch (err) {
    console.error('[liveavatar] session failed:', err.message || err);
    res.status(err.status || 502).json({ error: err.message || 'liveavatar_unavailable' });
  }
});

// Chat (with live-data tool calling)
app.post('/api/ask', async (req, res) => {
  try {
    requireKey(process.env.OPENAI_API_KEY, 'openai');
    if (!openai) throw new Error('openai_client_missing');

    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ error: 'message_required' });
    }

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-10)
      : [];

    let input = [
      ...history.map((m) => ({
        role: m.role === 'mike' ? 'assistant' : 'user',
        content: [{ type: m.role === 'mike' ? 'output_text' : 'input_text', text: String(m.text || '') }],
      })),
      {
        role: 'user',
        content: [{ type: 'input_text', text: message }],
      },
    ];

    // Owner sees their own business data; everyone else does not.
    const owner = isOwner(req.user);
    const tools = owner ? LIVE_TOOLS : PUBLIC_TOOLS;
    const instructions = owner ? MIKE_INSTRUCTIONS : MIKE_INSTRUCTIONS + NON_OWNER_NOTE;

    let text = "I'm here. Give me another shot.";

    // Function-calling loop: Mike can pull live data before answering.
    // Capped so a misbehaving tool call can't loop forever.
    for (let round = 0; round < 4; round += 1) {
      const response = await openai.responses.create({
        model: OPENAI_MODEL,
        instructions,
        input,
        tools,
      });

      const calls = (response.output || []).filter((item) => item.type === 'function_call');

      if (!calls.length) {
        text = response.output_text?.trim() || text;
        break;
      }

      // Carry the model's own output forward so it has the context of its
      // own tool calls when it sees the results next round.
      input = [...input, ...response.output];

      for (const call of calls) {
        let args = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          // leave args empty; the handler below errors on missing fields
        }

        const handler = LIVE_TOOL_HANDLERS[call.name];
        let output;
        try {
          if (!owner && OWNER_ONLY_TOOLS.has(call.name)) {
            // Should be unreachable - the tool isn't in the list a non-owner
            // gets - but a model can hallucinate a call, so refuse here too.
            console.warn(`[ask] blocked owner-only tool ${call.name} for non-owner`);
            output = { error: 'not_available', note: "That is Mike's own private business data." };
          } else {
            output = handler ? await handler(args) : { error: `Unknown tool \"${call.name}\".` };
          }
        } catch (toolErr) {
          console.error(`[ask] tool ${call.name} failed:`, toolErr.message || toolErr);
          output = { error: toolErr.message || 'tool_unavailable' };
        }

        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(output),
        });
      }
    }

    res.json({ text });
  } catch (err) {
    console.error('[ask] failed:', err.message || err);
    res.status(err.status || 502).json({
      error: err.message || 'mike_ai_unavailable',
    });
  }
});

// TTS + optional lip-sync
app.post('/api/tts', async (req, res) => {
  try {
    requireKey(process.env.ELEVENLABS_API_KEY, 'elevenlabs');

    const text = String(req.body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'text_required' });
    }

    const voiceId = await resolveMikeVoice();

    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: ELEVEN_MODEL,
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.85,
            style: 0.25,
            use_speaker_boost: true,
            speed: 1.08,
          },
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      throw new Error(`elevenlabs_tts_${ttsRes.status}: ${errText.slice(0, 200)}`);
    }

    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
    const audioBase64 = audioBuffer.toString('base64');

    let generationId = null;

    // Lip-sync is OFF by default. It uploaded the mp3 to fal and queued a render
    // job before this route replied, adding seconds to every spoken answer for a
    // video the voice-only client never used. Set MIKE_LIPSYNC=true to re-enable.
    if (process.env.FAL_KEY && String(process.env.MIKE_LIPSYNC || '') === 'true') {
      try {
        console.log('[tts] uploading audio for lip-sync, size:', audioBuffer.length);

        const audioFile = new File([audioBuffer], 'mike-response.mp3', {
          type: 'audio/mpeg',
        });
        const audioUrl = await fal.storage.upload(audioFile);

        console.log('[tts] audio uploaded:', audioUrl);

        const queued = await fal.queue.submit(FAL_MODEL, {
          input: {
            video_url: PREVIEW_VIDEO,
            audio_url: audioUrl,
          },
          headers: { 'X-Fal-No-Retry': '1' },
        });

        generationId = queued.request_id;
        console.log('[tts] lip-sync queued:', generationId);
      } catch (avatarErr) {
        console.error('[tts] lip-sync failed (voice will still work):', avatarErr.message || avatarErr);
        // Continue - we still return the audio
      }
    } else {
      console.log('[tts] lip-sync disabled - voice only');
    }

    res.json({
      audioBase64,
      mimeType: 'audio/mpeg',
      voiceId,
      generationId,
    });
  } catch (err) {
    console.error('[tts] failed:', err.message || err);
    res.status(err.status || 502).json({
      error: err.message || 'mike_voice_unavailable',
    });
  }
});

// Manual lip-sync submit
app.post('/api/avatar', async (req, res) => {
  try {
    requireKey(process.env.FAL_KEY, 'fal');

    const audioBase64 = String(req.body?.audioBase64 || '').trim();
    if (!audioBase64) {
      return res.status(400).json({ error: 'audio_required' });
    }

    const audioBytes = Buffer.from(audioBase64, 'base64');
    if (!audioBytes.length) {
      return res.status(400).json({ error: 'audio_invalid' });
    }

    console.log('[avatar] uploading audio, size:', audioBytes.length);

    const audioFile = new File([audioBytes], 'mike-response.mp3', {
      type: 'audio/mpeg',
    });
    const audioUrl = await fal.storage.upload(audioFile);

    const { request_id } = await fal.queue.submit(FAL_MODEL, {
      input: {
        video_url: PREVIEW_VIDEO,
        audio_url: audioUrl,
      },
      headers: { 'X-Fal-No-Retry': '1' },
    });

    console.log('[avatar] queued:', request_id);
    res.json({ generationId: request_id });
  } catch (err) {
    console.error('[avatar] submit failed:', err.message || err);
    res.status(err.status || 502).json({
      error: err.message || 'lipsync_unavailable',
    });
  }
});

// Poll lip-sync status
app.get('/api/avatar/:id', async (req, res) => {
  try {
    requireKey(process.env.FAL_KEY, 'fal');

    const id = req.params.id;
    const status = await fal.queue.status(FAL_MODEL, { requestId: id });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(FAL_MODEL, { requestId: id });
      const videoUrl = result?.data?.video?.url || null;

      return res.json({
        status: 'completed',
        videoUrl,
      });
    }

    if (status.status === 'FAILED') {
      return res.json({ status: 'failed' });
    }

    res.json({ status: 'processing' });
  } catch (err) {
    console.error('[avatar] status failed:', err.message || err);
    res.status(err.status || 502).json({
      error: err.message || 'lipsync_status_unavailable',
    });
  }
});

// Proxy the source video
app.get('/api/avatar-preview', async (req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const range = req.headers.range;
    const headers = range ? { Range: range } : {};

    const upstream = await fetch(PREVIEW_VIDEO, {
      headers,
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      throw new Error(`preview_fetch_${upstream.status}`);
    }

    res.status(upstream.status);

    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('[preview] failed:', err.message || err);
    if (!res.headersSent) {
      res.status(err.name === 'AbortError' ? 504 : 502).json({
        error: 'avatar_preview_unavailable',
      });
    }
  } finally {
    clearTimeout(timer);
  }
});

// Block sensitive paths
app.use((req, res, next) => {
  if (
    /(^|\/)\.(env|git|svn|hg)(?:$|\/)/i.test(req.path) ||
    /^(?:\/)(?:config\.json|wp-admin|wp-login\.php|phpmyadmin|server-status|actuator|telescope|trace\.axd)/i.test(req.path)
  ) {
    return res.status(404).end();
  }
  next();
});

// Static + SPA fallback
app.use(
  express.static(path.join(__dirname, '..', 'dist'), {
    maxAge: '1h',
    etag: true,
    dotfiles: 'deny',
  })
);

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// Schema is idempotent; a failure here logs and leaves accounts disabled
// rather than taking the whole server down.
migrate().catch((err) => console.error('[db] migrate threw:', err.message || err));

const server = http.createServer(app);

server.listen(PORT, async () => {
  console.log(`[mike-ai] listening on port ${PORT}`);
  console.log(`[mike-ai] openai: ${!!process.env.OPENAI_API_KEY}`);
  console.log(`[mike-ai] elevenlabs: ${!!process.env.ELEVENLABS_API_KEY}`);
  console.log(`[mike-ai] fal: ${!!process.env.FAL_KEY}`);
  console.log(`[mike-ai] accounts: ${authConfigured()}`);
  try {
    const engineId = await initializeSpeechEngine(server);
    console.log(`[mike-ai] realtime voice ready: ${engineId || 'disabled'}`);
  } catch (err) {
    console.error('[mike-ai] realtime voice initialization failed:', err.message || err);
  }
});
