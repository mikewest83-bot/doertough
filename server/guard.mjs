// server/guard.mjs
//
// Abuse and security guards for routes that cost money or invite guessing.
// Authentication is mandatory for paid AI/voice operations; Origin and rate
// limits remain secondary layers. Voice-token requests are also serialized per
// account in-process to close the common concurrent-reservation race while the
// durable Postgres reservation is being tightened for multi-instance scaling.

const PROTECTED = [
  '/api/ask',
  '/api/tts',
  '/api/avatar',
  '/api/speech/token',
  '/api/client-log',
  '/api/liveavatar/session',
];

const AUTH_PROTECTED = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];

const DEFAULT_ORIGINS = [
  'https://doertoughmikeai.com',
  'https://www.doertoughmikeai.com',
  'https://mike-ai-production.up.railway.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

const EXTRA_ORIGINS = (process.env.MIKE_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS]);
const REQUIRE_ORIGIN = String(process.env.MIKE_REQUIRE_ORIGIN || '') === 'true';
const PER_HOUR = Number(process.env.MIKE_RATE_PER_HOUR || 40);
const PER_MINUTE = Number(process.env.MIKE_RATE_PER_MINUTE || 8);
const AUTH_PER_HOUR = Number(process.env.MIKE_AUTH_PER_HOUR || 20);
const AUTH_PER_MINUTE = Number(process.env.MIKE_AUTH_PER_MINUTE || 5);
const ACCESS_CODE = process.env.MIKE_ACCESS_CODE || '';

// Tight server-side request limits. The global express.json limit remains a
// last-resort ceiling, but paid routes should reject much smaller payloads.
const ASK_MESSAGE_MAX = Number(process.env.MIKE_ASK_MESSAGE_MAX || 4000);
const ASK_HISTORY_MAX = Number(process.env.MIKE_ASK_HISTORY_MAX || 12000);
const ASK_HISTORY_ITEM_MAX = Number(process.env.MIKE_ASK_HISTORY_ITEM_MAX || 3000);
const TTS_TEXT_MAX = Number(process.env.MIKE_TTS_TEXT_MAX || 4000);
const AVATAR_AUDIO_B64_MAX = Number(process.env.MIKE_AVATAR_AUDIO_B64_MAX || 5_000_000);

// key -> { hour: { count, resetAt }, minute: { count, resetAt } }
const buckets = new Map();

// One active token reservation per account per process. This is intentionally
// a fast concurrency guard, not the durable billing boundary. PostgreSQL still
// owns the real reservation accounting and must become the source of truth for
// multi-instance deployments.
const voiceLocks = new Map();

async function withVoiceLock(key, fn) {
  const previous = voiceLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  voiceLocks.set(key, previous.then(() => current));
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (voiceLocks.get(key) === current) voiceLocks.delete(key);
  }
}

function hit(key, perMinute, perHour) {
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry) {
    entry = {
      hour: { count: 0, resetAt: now + 3600_000 },
      minute: { count: 0, resetAt: now + 60_000 },
    };
    buckets.set(key, entry);
  }

  for (const [window, ms] of [['hour', 3600_000], ['minute', 60_000]]) {
    if (now > entry[window].resetAt) {
      entry[window].count = 0;
      entry[window].resetAt = now + ms;
    }
  }

  entry.hour.count += 1;
  entry.minute.count += 1;
  if (entry.minute.count > perMinute) {
    return { ok: false, retryAfter: Math.ceil((entry.minute.resetAt - now) / 1000), window: 'minute' };
  }
  if (entry.hour.count > perHour) {
    return { ok: false, retryAfter: Math.ceil((entry.hour.resetAt - now) / 1000), window: 'hour' };
  }
  return { ok: true, remaining: perHour - entry.hour.count };
}

function rejectPayload(req, res) {
  if (req.path === '/api/ask') {
    const message = String(req.body?.message || '');
    if (message.length > ASK_MESSAGE_MAX) {
      return res.status(413).json({ error: 'message_too_large', maxCharacters: ASK_MESSAGE_MAX });
    }
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    let total = 0;
    for (const item of history.slice(-10)) {
      const text = String(item?.text || '');
      if (text.length > ASK_HISTORY_ITEM_MAX) {
        return res.status(413).json({ error: 'history_item_too_large', maxCharacters: ASK_HISTORY_ITEM_MAX });
      }
      total += text.length;
    }
    if (total > ASK_HISTORY_MAX) {
      return res.status(413).json({ error: 'history_too_large', maxCharacters: ASK_HISTORY_MAX });
    }
  }

  if (req.path === '/api/tts') {
    const text = String(req.body?.text || '');
    if (text.length > TTS_TEXT_MAX) {
      return res.status(413).json({ error: 'tts_text_too_large', maxCharacters: TTS_TEXT_MAX });
    }
  }

  if (req.path === '/api/avatar') {
    const audioBase64 = String(req.body?.audioBase64 || '');
    if (audioBase64.length > AVATAR_AUDIO_B64_MAX) {
      return res.status(413).json({ error: 'audio_too_large', maxBase64Characters: AVATAR_AUDIO_B64_MAX });
    }
  }

  return null;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now > entry.hour.resetAt) buckets.delete(key);
  }
}, 600_000).unref?.();

const matches = (path, list) =>
  list.some((p) => path === p || path.startsWith(`${p}/`));

export function installGuards(app) {
  app.set('trust proxy', 1);

  app.use(async (req, res, next) => {
    const isAuthRoute = matches(req.path, AUTH_PROTECTED);
    const isProtected = matches(req.path, PROTECTED);
    if (!isAuthRoute && !isProtected) return next();

    // Paid AI/voice endpoints are never anonymous. Origin is not auth.
    if (isProtected && !req.user) {
      return res.status(401).json({ error: 'sign_in_required', message: 'Sign in to use this Mike capability.' });
    }

    if (ACCESS_CODE && isProtected && req.get('x-mike-code') !== ACCESS_CODE) {
      return res.status(401).json({ error: 'access_code_required' });
    }

    const origin = req.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      console.warn(`[guard] blocked origin: ${origin} -> ${req.path}`);
      return res.status(403).json({ error: 'origin_not_allowed' });
    }
    if (!origin && REQUIRE_ORIGIN) {
      return res.status(403).json({ error: 'origin_required' });
    }

    const payloadError = rejectPayload(req, res);
    if (payloadError) return payloadError;

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const identity = req.user?.id ? `user:${req.user.id}` : `ip:${ip}`;
    const key = isAuthRoute ? `auth:${ip}` : identity;
    const result = isAuthRoute
      ? hit(key, AUTH_PER_MINUTE, AUTH_PER_HOUR)
      : hit(key, PER_MINUTE, PER_HOUR);

    if (!result.ok) {
      console.warn(`[guard] rate limited ${key} (${result.window}) -> ${req.path}`);
      res.setHeader('Retry-After', String(result.retryAfter));
      return res.status(429).json({
        error: 'rate_limited',
        message: isAuthRoute
          ? 'Too many attempts. Wait a minute and try again.'
          : "Mike's catching his breath. Try again in a minute.",
        retryAfterSeconds: result.retryAfter,
      });
    }

    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (req.path === '/api/speech/token' && req.user?.id) {
      const lockKey = `voice:${req.user.id}`;
      return withVoiceLock(lockKey, () => new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        res.once('finish', finish);
        res.once('close', finish);
        next();
      }));
    }

    next();
  });

  console.log(
    `[guard] active — ${PER_MINUTE}/min, ${PER_HOUR}/hr per caller; ` +
      `auth ${AUTH_PER_MINUTE}/min, ${AUTH_PER_HOUR}/min per IP; ` +
      `${ALLOWED_ORIGINS.size} allowed origins; paid routes require auth`
  );
}
