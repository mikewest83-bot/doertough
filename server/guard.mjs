// server/guard.mjs
//
// Abuse guards for the routes that cost money: /api/ask (OpenAI) and
// /api/tts (ElevenLabs). Everything here is in-memory and dependency-free,
// so it survives a restart by simply forgetting — which is fine, the point
// is to stop a scraper hammering the endpoints, not to bill anyone.
//
// Env knobs (all optional):
//   MIKE_ALLOWED_ORIGINS   csv of extra origins to allow
//   MIKE_REQUIRE_ORIGIN    'true' to reject requests with no Origin header
//   MIKE_RATE_PER_HOUR     default 40
//   MIKE_RATE_PER_MINUTE   default 8
//   MIKE_ACCESS_CODE       if set, requests must send x-mike-code with it

const PROTECTED = ['/api/ask', '/api/tts', '/api/avatar', '/api/liveavatar/session'];

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
const ACCESS_CODE = process.env.MIKE_ACCESS_CODE || '';

// ip -> { hour: { count, resetAt }, minute: { count, resetAt } }
const buckets = new Map();

function hit(ip) {
  const now = Date.now();
  let entry = buckets.get(ip);

  if (!entry) {
    entry = {
      hour: { count: 0, resetAt: now + 3600_000 },
      minute: { count: 0, resetAt: now + 60_000 },
    };
    buckets.set(ip, entry);
  }

  for (const [window, ms] of [['hour', 3600_000], ['minute', 60_000]]) {
    if (now > entry[window].resetAt) {
      entry[window].count = 0;
      entry[window].resetAt = now + ms;
    }
  }

  entry.hour.count += 1;
  entry.minute.count += 1;

  if (entry.minute.count > PER_MINUTE) {
    return { ok: false, retryAfter: Math.ceil((entry.minute.resetAt - now) / 1000), window: 'minute' };
  }
  if (entry.hour.count > PER_HOUR) {
    return { ok: false, retryAfter: Math.ceil((entry.hour.resetAt - now) / 1000), window: 'hour' };
  }

  return { ok: true, remaining: PER_HOUR - entry.hour.count };
}

// Drop stale IPs every 10 minutes so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of buckets) {
    if (now > entry.hour.resetAt) buckets.delete(ip);
  }
}, 600_000).unref?.();

export function installGuards(app) {
  // Railway terminates TLS upstream, so the real client IP is in
  // X-Forwarded-For. Without this every request looks like one IP.
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    if (!PROTECTED.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      return next();
    }

    // 1. Shared secret, if one is configured.
    if (ACCESS_CODE && req.get('x-mike-code') !== ACCESS_CODE) {
      return res.status(401).json({ error: 'access_code_required' });
    }

    // 2. Origin allowlist. A browser always sends Origin on a cross-origin
    //    POST, so a mismatched one is a hotlinker. A missing one is usually
    //    curl or a native client — allowed unless MIKE_REQUIRE_ORIGIN=true.
    const origin = req.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      console.warn(`[guard] blocked origin: ${origin} -> ${req.path}`);
      return res.status(403).json({ error: 'origin_not_allowed' });
    }
    if (!origin && REQUIRE_ORIGIN) {
      return res.status(403).json({ error: 'origin_required' });
    }

    // 3. Rate limit.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const result = hit(ip);
    if (!result.ok) {
      console.warn(`[guard] rate limited ${ip} (${result.window}) -> ${req.path}`);
      res.setHeader('Retry-After', String(result.retryAfter));
      return res.status(429).json({
        error: 'rate_limited',
        message: "Mike's catching his breath. Try again in a minute.",
        retryAfterSeconds: result.retryAfter,
      });
    }

    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    next();
  });

  console.log(
    `[guard] active — ${PER_MINUTE}/min, ${PER_HOUR}/hr per IP; ` +
      `${ALLOWED_ORIGINS.size} allowed origins; access code ${ACCESS_CODE ? 'ON' : 'off'}`
  );
}
