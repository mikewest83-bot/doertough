// server/guard.mjs
//
// Abuse guards for the routes that cost money or invite guessing:
//   /api/ask            OpenAI
//   /api/tts            ElevenLabs characters (legacy backend endpoint)
//   /api/speech/token   ElevenLabs agent MINUTES - the expensive one
//   /api/avatar         fal
//   /api/liveavatar/*   LiveAvatar session tokens
//   /api/auth/*         password guessing
//
// Everything here is in-memory and dependency-free, so it survives a restart
// by simply forgetting - which is fine for burst control. The limit that must
// NOT be forgettable is voice minutes, and that one lives in Postgres
// (see voice_sessions in db.mjs), not here.
//
// Env knobs (all optional):
//   MIKE_ALLOWED_ORIGINS   csv of extra origins to allow
//   MIKE_REQUIRE_ORIGIN    'true' to reject requests with no Origin header
//   MIKE_RATE_PER_HOUR     default 40
//   MIKE_RATE_PER_MINUTE   default 8
//   MIKE_AUTH_PER_HOUR     default 20   (login/register attempts)
//   MIKE_AUTH_PER_MINUTE   default 5
//   MIKE_ACCESS_CODE       if set, requests must send x-mike-code with it

const PROTECTED = [
  '/api/ask',
  '/api/tts',
  '/api/avatar',
  '/api/speech/token',
  '/api/client-log',
  '/api/liveavatar/session',
];

// Auth routes get their own, tighter budget. Unlimited password attempts undo
// every other precaution in the login handler.
const AUTH_PROTECTED = [
  '/api/auth/login',
  '/api/auth/register',
  // Reset endpoints are password-guessing adjacent: forgot-password is an
  // email-enumeration probe if left open, reset-password is a token guess.
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

// key -> { hour: { count, resetAt }, minute: { count, resetAt } }
const buckets = new Map();

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

// Drop stale keys every 10 minutes so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now > entry.hour.resetAt) buckets.delete(key);
  }
}, 600_000).unref?.();

const matches = (path, list) =>
  list.some((p) => path === p || path.startsWith(`${p}/`));

export function installGuards(app) {
  // Low-risk browser hardening. These headers don't impose a CSP or change
  // resource loading, so they won't interfere with Mike's current frontend.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
    next();
  });

  // Railway terminates TLS upstream, so the real client IP is in
  // X-Forwarded-For. Without this every request looks like one IP.
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    const isAuthRoute = matches(req.path, AUTH_PROTECTED);
    const isProtected = matches(req.path, PROTECTED);

    if (!isAuthRoute && !isProtected) return next();

    // 1. Shared secret, if one is configured.
    if (ACCESS_CODE && !isAuthRoute && req.get('x-mike-code') !== ACCESS_CODE) {
      return res.status(401).json({ error: 'access_code_required' });
    }

    // 2. Origin allowlist. A browser always sends Origin on a cross-origin
    //    POST, so a mismatched one is a hotlinker. A missing one is usually
    //    curl or a native client - allowed unless MIKE_REQUIRE_ORIGIN=true.
    const origin = req.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      console.warn(`[guard] blocked origin: ${origin} -> ${req.path}`);
      return res.status(403).json({ error: 'origin_not_allowed' });
    }
    if (!origin && REQUIRE_ORIGIN) {
      return res.status(403).json({ error: 'origin_required' });
    }

    // 3. Rate limit. Signed-in requests are keyed on the account, so one
    //    office behind a single IP isn't throttled as if it were one person,
    //    and a single account can't dodge the limit by changing networks.
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
    next();
  });

  console.log(
    `[guard] active — ${PER_MINUTE}/min, ${PER_HOUR}/hr per caller; ` +
      `auth ${AUTH_PER_MINUTE}/min, ${AUTH_PER_HOUR}/hr per IP; ` +
      `${ALLOWED_ORIGINS.size} allowed origins; access code ${ACCESS_CODE ? 'ON' : 'off'}`
  );
}
