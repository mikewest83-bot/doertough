import express from 'express';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { fal } from '@fal-ai/client';

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
app.use(express.json({ limit: '15mb' }));

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
// Safe to open in a browser — never returns the API key or a usable token.
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

// Chat
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

    const input = [
      ...history.map((m) => ({
        role: m.role === 'mike' ? 'assistant' : 'user',
        content: [{ type: m.role === 'mike' ? 'output_text' : 'input_text', text: String(m.text || '') }],
      })),
      {
        role: 'user',
        content: [{ type: 'input_text', text: message }],
      },
    ];

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions:
        'You are Mike AI, the upbeat Doer Tough everyday copilot. Speak naturally, confidently, clearly, and with a warm Southern American conversational feel. Use excellent grammar and concise useful answers. Do not claim to know private facts. When current facts matter, say they should be verified.',
      input,
    });

    const text = response.output_text?.trim() || "I'm here. Give me another shot.";
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

    // Try lip-sync only if FAL_KEY exists (non-blocking)
    if (process.env.FAL_KEY) {
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
        // Continue — we still return the audio
      }
    } else {
      console.log('[tts] FAL_KEY not set — skipping lip-sync');
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

app.listen(PORT, () => {
  console.log(`[mike-ai] listening on port ${PORT}`);
  console.log(`[mike-ai] openai: ${!!process.env.OPENAI_API_KEY}`);
  console.log(`[mike-ai] elevenlabs: ${!!process.env.ELEVENLABS_API_KEY}`);
  console.log(`[mike-ai] fal: ${!!process.env.FAL_KEY}`);
});