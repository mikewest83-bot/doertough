import express from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { LIVE_TOOLS as BASE_TOOLS, LIVE_TOOL_HANDLERS as BASE_HANDLERS } from './live.mjs';
import { BUSINESS_TOOLS, BUSINESS_TOOL_HANDLERS } from './business.mjs';
import { FREE_TOOLS, FREE_TOOL_HANDLERS } from './free-tools.mjs';
import { FIELD_TOOLS, FIELD_TOOL_HANDLERS } from './field-tools.mjs';
import { MONEY_TOOLS, MONEY_TOOL_HANDLERS } from './money-tools.mjs';
import { DOERTOUGH_INTELLIGENCE_TOOLS, DOERTOUGH_INTELLIGENCE_HANDLERS } from './doertough-intelligence-tools.mjs';
import { createMikeToolGateway } from './mike-tool-gateway.mjs';
import { installGuards } from './guard.mjs';
import { ensureRbacSchema, getRbacOverview } from './rbac.mjs';
import { REMINDER_TOOLS, setReminderTool, listRemindersTool, cancelReminderTool, ensureReminderSchema } from './reminders.mjs';
import { mailerConfigured } from './mailer.mjs';
import { MIKE_INSTRUCTIONS } from './persona.mjs';
import { getRelevantMemories, listMemories, saveMemory, deleteMemory, memoryPrompt, CATEGORIES } from './memory.mjs';
import {
  recordVoiceSession,
  closeVoiceSession,
  countVoiceSessions,
  countVoiceSessionsGlobal,
  countVoiceSeconds,
  countVoiceSecondsGlobal,
} from './db.mjs';
import { hasPaidAccess } from './entitlements.mjs';
import {
  createCheckoutSession,
  createPortalSession,
  billingConfigured,
  hasActiveSubscription,
} from './billing.mjs';
import { initializeSpeechEngine, getSpeechEngineToken } from './speech-engine.mjs';
import { analyzeVisionImage } from './vision.mjs';
import {
  verifyStripeSignature,
  stripeWebhookConfigured,
  handleStripeWebhook,
} from './stripe-webhook.mjs';
import {
  register,
  login,
  me,
  requestPasswordReset,
  resetPassword,
  authRequired,
  optionalAuth,
  isOwner,
  authConfigured,
} from './auth.mjs';
import { reserveVoiceSession, releaseVoiceReservation } from './voice-reservations.mjs';
import { getRealtimeToolHandler, isRealtimeToolAllowed } from './realtime-tools.mjs';
import { OWNER_ONLY_TOOLS } from './tool-access.mjs';

const LIVE_TOOLS = [...BASE_TOOLS, ...BUSINESS_TOOLS, ...FREE_TOOLS, ...FIELD_TOOLS, ...MONEY_TOOLS, ...REMINDER_TOOLS, ...DOERTOUGH_INTELLIGENCE_TOOLS];
const LIVE_TOOL_HANDLERS = {
  ...BASE_HANDLERS,
  ...BUSINESS_TOOL_HANDLERS,
  ...FREE_TOOL_HANDLERS,
  ...FIELD_TOOL_HANDLERS,
  ...MONEY_TOOL_HANDLERS,
  ...DOERTOUGH_INTELLIGENCE_HANDLERS,
};

const PUBLIC_TOOLS = LIVE_TOOLS.filter((tool) => !OWNER_ONLY_TOOLS.has(tool.name));
const NON_OWNER_NOTE =
  '\n\nTOOL AVAILABILITY FOR THIS CONVERSATION\n' +
  'You are talking with a visitor, not Mike. The store-sales and trading-account ' +
  'tools are not available in this conversation and you cannot see those numbers. ' +
  'If asked about Doer Tough revenue, order counts, or the trading account balance, ' +
  'say plainly that those are Mike\'s own private business numbers and you do not ' +
  'share them. Do not guess, estimate, or invent any figure. Everything else you ' +
  'know about the portfolio is fair game.';

const mikeToolGateway = createMikeToolGateway({
  handlers: LIVE_TOOL_HANDLERS,
  authorize: async ({ name, user }) => {
    const owner = isOwner(user);
    return owner || !OWNER_ONLY_TOOLS.has(name);
  },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.disable('x-powered-by');

const requireKey = (key, name) => {
  if (!key) {
    const error = new Error(`${name}_not_configured`);
    error.status = 503;
    throw error;
  }
};

// ===== Stripe webhook =====
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripeWebhookConfigured()) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET is not set - rejecting webhook.');
    return res.status(503).json({ error: 'stripe_webhook_not_configured' });
  }
  if (!Buffer.isBuffer(req.body)) {
    console.error('[stripe] raw body unavailable - express.raw() did not run first.');
    return res.status(500).json({ error: 'raw_body_unavailable' });
  }

  const rawBody = req.body.toString('utf8');
  if (!verifyStripeSignature(rawBody, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET)) {
    console.warn('[stripe] signature verification failed');
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  res.json({ received: true });
  try {
    await handleStripeWebhook(event);
  } catch (error) {
    console.error('[stripe] handler error:', error);
  }
});

app.use(express.json({ limit: '15mb' }));
app.post('/api/vision/analyze', authRequired, analyzeVisionImage);
app.use(optionalAuth);
installGuards(app);

// ===== Accounts =====
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/auth/me', authRequired, me);
app.post('/api/auth/forgot-password', requestPasswordReset);
app.post('/api/auth/reset-password', resetPassword);

// ===== Owner-only roadmap controls =====
app.get('/api/owner/overview', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    res.json(await getRbacOverview());
  } catch (error) {
    console.error('[owner] overview failed:', error.message || error);
    res.status(500).json({ error: 'owner_overview_unavailable' });
  }
});

// ===== Realtime voice =====
// OpenAI Realtime is the only production voice transport. The browser gets a
// short-lived client secret from this route, then connects directly over WebRTC.
// Voice reservations are bounded per account and across the whole service.
const MAX_SESSION_SECONDS = Number(process.env.VOICE_MAX_SESSION_SECONDS || 600);
const PAID_SESSION_LIMIT = Number(process.env.VOICE_SESSIONS_PRO || 40);
const FREE_SESSION_LIMIT = Number(process.env.VOICE_SESSIONS_FREE || 1);
const GLOBAL_SESSION_LIMIT = Number(process.env.VOICE_SESSIONS_GLOBAL || 120);
const PAID_MINUTE_LIMIT = Number(process.env.VOICE_MINUTES_PRO || 200);
const FREE_MINUTE_LIMIT = Number(process.env.VOICE_MINUTES_FREE || 10);
const GLOBAL_MINUTE_LIMIT = Number(process.env.VOICE_MINUTES_GLOBAL || 5000);

app.get('/api/speech/token', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'sign_in_required', message: 'Sign in to talk with Mike.' });
    }

    const paidAccess = hasPaidAccess(req.user);
    const sessionLimit = paidAccess ? PAID_SESSION_LIMIT : FREE_SESSION_LIMIT;
    const minuteLimit = paidAccess ? PAID_MINUTE_LIMIT : FREE_MINUTE_LIMIT;
    // OWNER VOICE QA BYPASS
    const ownerVoiceQa = isOwner(req.user);
    const outOfBudget = () => res.status(402).json({
      error: paidAccess ? 'voice_allowance_reached' : 'upgrade_required',
      message: paidAccess
        ? "You've used this month's voice time. It resets on a rolling 30-day window."
        : 'Start your free trial to talk with Mike.',
    });

    // ownerVoiceQa is installed once by patch-index-realtime-tools.mjs.
    // Reuse it here rather than redeclaring the const in the same route scope.
    const secondsAllowance = minuteLimit * 60;

    // The reservation is the authoritative admission decision. PostgreSQL
    // serializes it so concurrent token requests cannot both pass the budget.
    const reservationLimits = ownerVoiceQa
      ? { accountSessionLimit: Number.MAX_SAFE_INTEGER, accountSecondLimit: Number.MAX_SAFE_INTEGER, globalSessionLimit: Number.MAX_SAFE_INTEGER, globalSecondLimit: Number.MAX_SAFE_INTEGER }
      : { accountSessionLimit: sessionLimit, accountSecondLimit: secondsAllowance, globalSessionLimit: GLOBAL_SESSION_LIMIT, globalSecondLimit: GLOBAL_MINUTE_LIMIT * 60 };

    const sessionKey = crypto.randomUUID();
    const agentId = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
    const reserveResult = await reserveVoiceSession({
      userId: req.user.id,
      agentId,
      sessionKey,
      reservedSeconds: MAX_SESSION_SECONDS,
      ...reservationLimits,
    });

    if (!reserveResult.ok) {
      if (reserveResult.reason === 'account_session_limit' || reserveResult.reason === 'account_second_limit') return outOfBudget();
      if (reserveResult.reason === 'global_session_limit' || reserveResult.reason === 'global_second_limit') {
        console.error('[speech-engine] global ceiling hit during atomic reservation');
        return res.status(503).json({ error: 'voice_capacity_reached', message: 'Mike is at capacity right now. Try again a bit later.' });
      }
      return res.status(503).json({ error: 'voice_reservation_failed' });
    }

    let result;
    try {
      result = await getSpeechEngineToken();
    } catch (error) {
      try { await releaseVoiceReservation(sessionKey, req.user.id); }
      catch (releaseError) { console.error('[speech-engine] failed to release reservation after token failure:', releaseError.message || releaseError); }
      throw error;
    }

    res.json({
      ...result,
      sessionKey,
      maxSessionSeconds: MAX_SESSION_SECONDS,
      minutesRemaining: Math.max(0, Math.floor((secondsAllowance - MAX_SESSION_SECONDS) / 60)),
    });
  } catch (error) {
    console.error('[speech-engine] token failed:', error.message || error);
    res.status(error.status || 502).json({ error: error.message || 'speech_engine_unavailable' });
  }
});

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
    if (!row) return res.json({ settled: false });

    console.log(`[speech-engine] session settled: ${seconds}s for account #${req.user.id}`);
    res.json({ settled: true, seconds });
  } catch (error) {
    console.error('[speech-engine] settle failed:', error.message || error);
    res.status(500).json({ error: 'settle_failed' });
  }
});

// ===== Persistent reminders / alarms =====
app.get('/api/reminders', authRequired, async (req, res) => {
  try {
    res.json({ reminders: await listRemindersTool(req.user.id, { includePast: req.query?.includePast === 'true' }) });
  } catch (error) {
    console.error('[reminders] list route failed:', error.message || error);
    res.status(500).json({ error: 'reminders_unavailable' });
  }
});

app.post('/api/reminders', authRequired, async (req, res) => {
  try {
    const result = await setReminderTool(req.user.id, req.body || {});
    if (result?.error) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[reminders] create route failed:', error.message || error);
    res.status(500).json({ error: 'reminder_create_failed' });
  }
});

app.delete('/api/reminders/:id', authRequired, async (req, res) => {
  try {
    res.json(await cancelReminderTool(req.user.id, { id: Number(req.params.id) }));
  } catch (error) {
    console.error('[reminders] cancel route failed:', error.message || error);
    res.status(500).json({ error: 'reminder_cancel_failed' });
  }
});

// ===== Realtime public tool dispatch =====
// Voice tool calls are authenticated and executed server-side; the browser never
// receives private handlers or provider credentials.
app.post('/api/realtime/tool', authRequired, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!isRealtimeToolAllowed(name)) return res.status(403).json({ error: 'tool_not_allowed' });

    let args = req.body?.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { return res.status(400).json({ error: 'tool_arguments_invalid' }); }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return res.status(400).json({ error: 'tool_arguments_invalid' });

    const handler = getRealtimeToolHandler(name, req.user);
    if (!handler) return res.status(403).json({ error: 'tool_not_allowed' });

    // Preserve authenticated identity for every voice handler, matching the text gateway.
    const output = await handler({ ...args, user: req.user });
    const serialized = JSON.stringify(output ?? null);
    const safeOutput = serialized.length > 12000 ? serialized.slice(0, 11950) + '\n[output truncated]' : serialized;
    res.json({ output: safeOutput });
  } catch (error) {
    console.error('[realtime-tool] failed:', error.message || error);
    res.status(500).json({ error: error.message || 'tool_failed' });
  }
});

// ===== Billing =====
app.post('/api/billing/checkout', authRequired, async (req, res) => {
  try {
    if (hasActiveSubscription(req.user)) {
      const portal = await createPortalSession(req.user);
      return res.json({ ...portal, alreadySubscribed: true, message: 'You already have an active Mike subscription.' });
    }
    res.json(await createCheckoutSession(req.user));
  } catch (error) {
    console.error('[billing] checkout failed:', error.message || error);
    res.status(error.status || 502).json({ error: error.message || 'checkout_unavailable' });
  }
});

app.post('/api/billing/portal', authRequired, async (req, res) => {
  try {
    res.json(await createPortalSession(req.user));
  } catch (error) {
    console.error('[billing] portal failed:', error.message || error);
    res.status(error.status || 502).json({ error: error.message || 'portal_unavailable' });
  }
});

// ===== Client-side error reporting =====
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

// ===== Health =====
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'mike-ai',
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    voiceConfigured: !!process.env.OPENAI_API_KEY,
    liveToolsConfigured: true,
    toolCount: LIVE_TOOLS.length,
    voiceBudget: {
      maxSessionSeconds: MAX_SESSION_SECONDS,
      paidMinutes: PAID_MINUTE_LIMIT,
      freeMinutes: FREE_MINUTE_LIMIT,
      globalMinutes: GLOBAL_MINUTE_LIMIT,
      paidSessions: PAID_SESSION_LIMIT,
      globalSessions: GLOBAL_SESSION_LIMIT,
    },
    accountsConfigured: authConfigured(),
    mailConfigured: mailerConfigured(),
    billingConfigured: billingConfigured(),
    model: OPENAI_MODEL,
    timestamp: new Date().toISOString(),
  });
});

// ===== Chat =====
app.post('/api/ask', async (req, res) => {
  try {
    requireKey(process.env.OPENAI_API_KEY, 'openai');
    if (!openai) throw new Error('openai_client_missing');

    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message_required' });

    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    let input = [
      ...history.map((item) => ({
        role: item.role === 'mike' ? 'assistant' : 'user',
        content: [{ type: item.role === 'mike' ? 'output_text' : 'input_text', text: String(item.text || '') }],
      })),
      { role: 'user', content: [{ type: 'input_text', text: message }] },
    ];

    const owner = isOwner(req.user);
    const tools = owner ? LIVE_TOOLS : PUBLIC_TOOLS;
    const relevantMemories = req.user ? await getRelevantMemories(req.user.id, message, 12) : [];
    const instructions = (owner ? MIKE_INSTRUCTIONS : MIKE_INSTRUCTIONS + NON_OWNER_NOTE) + memoryPrompt(relevantMemories);
    let text = "I'm here. Give me another shot.";
    const REMINDER_TOOL_HANDLERS = req.user ? {
      set_reminder: (args) => setReminderTool(req.user.id, args),
      list_reminders: (args) => listRemindersTool(req.user.id, args),
      cancel_reminder: (args) => cancelReminderTool(req.user.id, args),
    } : {};

    for (let round = 0; round < 4; round += 1) {
      const response = await openai.responses.create({ model: OPENAI_MODEL, instructions, input, tools });
      const calls = (response.output || []).filter((item) => item.type === 'function_call');
      if (!calls.length) {
        text = response.output_text?.trim() || text;
        break;
      }

      input = [...input, ...response.output];
      for (const call of calls) {
        let args = {};
        try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch {}

        let output;
        try {
          if (!owner && OWNER_ONLY_TOOLS.has(call.name)) {
            output = { error: 'not_available', note: "That is Mike's own private business data." };
          } else {
            output = await mikeToolGateway.execute({ name: call.name, args, user: req.user });
          }
        } catch (toolError) {
          console.error(`[ask] tool ${call.name} failed:`, toolError.message || toolError);
          output = {
            error: toolError.message === 'mike_tool_unauthorized'
              ? 'not_available'
              : toolError.message === 'mike_tool_not_allowed'
                ? `Unknown tool "${call.name}".`
                : 'tool_unavailable',
          };
        }

        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
      }
    }

    res.json({ text });
  } catch (error) {
    console.error('[ask] failed:', error.message || error);
    res.status(error.status || 502).json({ error: error.message || 'mike_ai_unavailable' });
  }
});

// ===== Persistent account-scoped memory =====
app.get('/api/memory', authRequired, async (req, res) => {
  try {
    const category = req.query?.category ? String(req.query.category) : undefined;
    res.json({ memories: await listMemories(req.user.id, { category }) });
  } catch (error) {
    console.error('[memory] list failed:', error.message || error);
    res.status(500).json({ error: 'memory_unavailable' });
  }
});

app.post('/api/memory', authRequired, async (req, res) => {
  try {
    const category = String(req.body?.category || 'context');
    const memory = String(req.body?.memory || '').trim();
    if (!memory) return res.status(400).json({ error: 'memory_required' });
    if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'memory_category_invalid' });

    const saved = await saveMemory(req.user.id, {
      category,
      memory,
      importance: req.body?.importance,
      source: req.body?.source || 'user',
    });
    res.json({ memory: saved });
  } catch (error) {
    console.error('[memory] save failed:', error.message || error);
    res.status(500).json({ error: 'memory_save_failed' });
  }
});

app.delete('/api/memory/:id', authRequired, async (req, res) => {
  try {
    res.json({ deleted: await deleteMemory(req.user.id, req.params.id) });
  } catch (error) {
    console.error('[memory] delete failed:', error.message || error);
    res.status(500).json({ error: 'memory_delete_failed' });
  }
});

// ===== Block sensitive paths =====
app.use((req, res, next) => {
  if (
    /(^|\/)\.(env|git|svn|hg)(?:$|\/)/i.test(req.path) ||
    /^(?:\/)(?:config\.json|wp-admin|wp-login\.php|phpmyadmin|server-status|actuator|telescope|trace\.axd)/i.test(req.path)
  ) return res.status(404).end();
  next();
});

// ===== Static + SPA fallback =====
app.use(express.static(path.join(__dirname, '..', 'dist'), { maxAge: '1h', etag: true, dotfiles: 'deny' }));
app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));


const server = http.createServer(app);
server.listen(PORT, async () => {
  console.log(`[mike-ai] listening on port ${PORT}`);
  console.log(`[mike-ai] openai: ${!!process.env.OPENAI_API_KEY}`);
  console.log(`[mike-ai] accounts: ${authConfigured()}`);
  try {
    const engineId = await initializeSpeechEngine(server);
    console.log(`[mike-ai] realtime voice ready: ${engineId || 'disabled'}`);
  } catch (error) {
    console.error('[mike-ai] realtime voice initialization failed:', error.message || error);
  }
});
