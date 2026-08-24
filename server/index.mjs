import express from 'express';
import http from 'http';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { fal } from '@fal-ai/client';
import { LIVE_TOOLS as BASE_TOOLS, LIVE_TOOL_HANDLERS as BASE_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { installGuards } from './guard.mjs';
import { MIKE_INSTRUCTIONS } from './persona.mjs';
import { migrate } from './db.mjs';
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

const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS];
const LIVE_TOOL_HANDLERS = { ...BASE_HANDLERS, ...BUSINESS_TOOL_HANDLERS };

// Tools that read Mike's OWN business data. Everyone else gets the public
// Mike. These are filtered out of the tool list entirely for non-owners, so
// the model never even sees that they exist.
const OWNER_ONLY_TOOLS = new Set(['get_store_sales', 'get_bot_status']);

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
app.get('/api/speech/token', optionalAuth, async (req, res) => {
  try {
    const result = await getSpeechEngineToken();
    res.json(result);
  } catch (err) {
    console.error('[speech-engine] token failed:', err.message || err);
    res.status(err.status || 502).json({ error: err.message || 'speech_engine_unavailable' });
  }
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
    accountsConfigured: authConfigured(),
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

// Diagnostic: proves the key and avatar ID work before any client code exists.
// Safe to open in a browser - never returns the API key or a usable token.
app.get('/api/liveavatar/diag', async (req, res) => {
  const out = {
    apiKeyPresent: !!LA_KEY,
    avatarId: LA_AVATAR || null,
    voiceId: LA_VOICE || null,
    sandbox: LA_SANDBOX,
  };
  try {
    const token = await mintLiveAvatarToken();
    res.json({ ...out, ok: true, tokenMinted: true, tokenPrefix: token.slice(0, 6) + '...' });
  } catch (err) {
    console.error('[liveavatar] diag failed:', err.message || err);
    res.status(err.status || 502).json({ ...out, ok: false, tokenMinted: false, error: err.message || 'unknown' });
  }
});

// Chat (with live-data tool calling)
app.post('/api/ask', optionalAuth, async (req, res) => {
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
            output = handler ? await handler(args) : { error: `Unknown tool "${call.name}".` };
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
