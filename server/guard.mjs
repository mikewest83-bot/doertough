// server/guard.mjs
// Abuse guards for money-sensitive and authentication routes.
// Realtime voice has its own durable usage controls in Postgres; the token
// endpoint intentionally skips the generic in-memory limiter because voice
// startup can legitimately involve multiple HTTP requests.

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
  'https://mike-ai-vision-staging.up.railway.app',
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

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now > entry.hour.resetAt) buckets.delete(key);
  }
}, 600_000).unref?.();

const matches = (path, list) =>
  list.some((p) => path === p || path.startsWith(`${p}/`));

export function installGuards(app) {
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
    next();
  });

  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    const isAuthRoute = matches(req.path, AUTH_PROTECTED);
    const isProtected = matches(req.path, PROTECTED);
    const isVoiceToken = req.path === '/api/speech/token';

    if (!isAuthRoute && !isProtected) return next();

    if (ACCESS_CODE && !isAuthRoute && req.get('x-mike-code') !== ACCESS_CODE) {
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

    // Realtime token issuance is protected by authentication, origin checks,
    // and the durable Postgres voice allowance/reservation. It intentionally
    // skips the generic in-memory limiter because WebRTC startup can legitimately
    // make multiple token requests while negotiating a session.
    if (isVoiceToken) return next();

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
    `[guard] active — ${PER_MINUTE}/min, ${PER_HOUR}/hr general; ` +
      `voice token protected by auth/origin/Postgres allowance; ` +
      `auth ${AUTH_PER_MINUTE}/min, ${AUTH_PER_HOUR}/hr per IP; ` +
      `${ALLOWED_ORIGINS.size} allowed origins; access code ${ACCESS_CODE ? 'ON' : 'off'}`
  );
}
