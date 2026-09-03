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
import { CODING_TOOLS, CODING_TOOL_HANDLERS } from './coding-tools.mjs';
import { REMINDER_TOOLS, setReminderTool, listRemindersTool, cancelReminderTool, ensureReminderSchema } from './reminders.mjs';
import { reminderHandlerFor, startReminderScheduler } from './reminders.mjs';
import { RESALE_ALERT_TOOLS, resaleAlertHandlerFor, startResaleWatchScheduler } from './resale-alerts.mjs';
import { MONEY_TOOLS, MONEY_TOOL_HANDLERS } from './money-tools.mjs';
import { DOERTOUGH_INTELLIGENCE_TOOLS, DOERTOUGH_INTELLIGENCE_HANDLERS } from './doertough-intelligence-tools.mjs';
import { DEAL_FINDER_TOOLS, DEAL_FINDER_HANDLERS } from './deal-finder.mjs';

import { DEAL_ALERT_TOOLS, dealAlertHandlerFor, startDealAlertScheduler } from './deal-alerts.mjs';
import { createMikeToolGateway } from './mike-tool-gateway.mjs';
import { installGuards } from './guard.mjs';
import { ensureRbacSchema, getRbacOverview } from './rbac.mjs';
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
import { hasPaidAccess, isTrialSubscriber } from './entitlements.mjs';
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
import { pushConfigured, pushPublicKey, pushSubscribeHandler, pushUnsubscribeHandler } from './push-notifications.mjs';
import { smsConfigured, startPhoneVerification, confirmPhoneVerification, removePhoneSubscription, getSmsStatus } from './sms-notifications.mjs';
import { getOwnerMetrics } from './owner-metrics.mjs';
import { listConversations, getConversation, listVoiceCalls, getVoiceCall, recordVoiceTurn, voiceTranscriptsEnabled, listUsers, getUserConversations, getActivitySummary, searchConversations } from './owner-conversations.mjs';
import { generateBrainResponse, getBrainStatus } from './brain-router.mjs';
import { getBrainStatus } from './brain-router.mjs';

const LIVE_TOOLS = [
  ...BASE_TOOLS,
  ...BUSINESS_TOOLS,
  ...FREE_TOOLS,
  ...FIELD_TOOLS,
  ...MONEY_TOOLS,
  // DOERTOUGH_INTELLIGENCE_TOOLS already arrive via BASE_TOOLS -> DICTIONARY_TOOLS.
  ...DEAL_FINDER_TOOLS,
  ...REMINDER_TOOLS,
  ...RESALE_ALERT_TOOLS,
  ...DEAL_ALERT_TOOLS,
];

const ACCOUNT_SCOPED_TOOL_HANDLERS = Object.fromEntries([
  ...REMINDER_TOOLS.map((tool) => [
    tool.name,
    (args = {}) => reminderHandlerFor(tool.name, args?.user?.id)?.(args),
  ]),
  ...RESALE_ALERT_TOOLS.map((tool) => [
    tool.name,
    (args = {}) => resaleAlertHandlerFor(tool.name, args?.user?.id)?.(args),
  ]),
  ...DEAL_ALERT_TOOLS.map((tool) => [
    tool.name,
    (args = {}) => dealAlertHandlerFor(tool.name, args?.user?.id)?.(args),
  ]),
]);

const LIVE_TOOL_HANDLERS = {
  ...BASE_HANDLERS,
  ...BUSINESS_TOOL_HANDLERS,
  ...FREE_TOOL_HANDLERS,
  ...FIELD_TOOL_HANDLERS,
  ...MONEY_TOOL_HANDLERS,
  ...DOERTOUGH_INTELLIGENCE_HANDLERS,
  ...DEAL_FINDER_HANDLERS,
  ...ACCOUNT_SCOPED_TOOL_HANDLERS,
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
  handlers: { ...LIVE_TOOL_HANDLERS, find_local_deals: (input) => DEAL_FINDER_HANDLERS.find_local_deals?.(input) },
  authorize: async ({ name, user }) => {
    const owner = isOwner(user);
    return owner || !OWNER_ONLY_TOOLS.has(name);
  },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45_000);
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 })
  : null;

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
app.use(optionalAuth);
installGuards(app);

// Vision analysis is authenticated and must remain behind the shared guard stack.
app.post('/api/vision/analyze', authRequired, analyzeVisionImage);

// ===== Realtime WebRTC answer proxy =====
app.post('/api/realtime/webrtc-answer', authRequired, async (req, res) => {
  try {
    const sdp = String(req.body?.sdp || '');
    const clientSecret = String(req.get('x-mike-realtime-token') || '').trim();
    if (!sdp || sdp.length > 200000) return res.status(400).json({ error: 'sdp_invalid' });
    if (!clientSecret) return res.status(401).json({ error: 'realtime_token_required' });

    const form = new FormData();
    form.append('sdp', sdp);
    const origin = String(process.env.PUBLIC_APP_ORIGIN || 'https://doertoughmikeai.com').replace(/\/$/, '');
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + clientSecret,
        Origin: origin,
      },
      body: form,
    });

    const answer = await upstream.text();
    if (!upstream.ok) {
      console.error('[realtime] WebRTC answer failed:', upstream.status, answer.slice(0, 800));
      return res.status(upstream.status).json({ error: 'realtime_webrtc_failed', detail: answer.slice(0, 800) });
    }
    res.type('application/sdp').send(answer);
  } catch (error) {
    console.error('[realtime] WebRTC proxy error:', error.message || error);
    res.status(error.status || 502).json({ error: error.message || 'realtime_webrtc_proxy_failed' });
  }
});


// ===== Accounts =====
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/auth/me', authRequired, me);
app.post('/api/auth/forgot-password', requestPasswordReset);
app.post('/api/auth/reset-password', resetPassword);


// ===== Browser push notifications =====
app.get('/api/push/public-key', (_req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'push_not_configured' });
  res.json({ publicKey: pushPublicKey() });
});
app.post('/api/push/subscribe', authRequired, pushSubscribeHandler);
app.post('/api/push/unsubscribe', authRequired, pushUnsubscribeHandler);

// ===== Text (SMS) deal alerts =====
app.get('/api/sms/status', authRequired, async (req, res) => {
  try { res.json(await getSmsStatus(req.user.id)); }
  catch (error) { console.error('[sms] status failed:', error.message || error); res.status(500).json({ error: 'sms_status_failed' }); }
});
app.post('/api/sms/subscribe', authRequired, async (req, res) => {
  if (!smsConfigured()) return res.status(503).json({ error: 'sms_not_configured' });
  try {
    const { phone } = await startPhoneVerification(req.user.id, req.body?.phone);
    res.json({ ok: true, phone });
  } catch (error) {
    const code = error.message || 'sms_subscribe_failed';
    const status = code === 'sms_phone_invalid' ? 400 : code === 'sms_not_configured' ? 503 : 500;
    res.status(status).json({ error: code });
  }
});
app.post('/api/sms/verify', authRequired, async (req, res) => {
  try {
    const { phone } = await confirmPhoneVerification(req.user.id, req.body?.code);
    res.json({ ok: true, phone });
  } catch (error) {
    const code = error.message || 'sms_verify_failed';
    const status = ['sms_code_required', 'sms_code_mismatch', 'sms_code_expired', 'sms_no_pending_code'].includes(code) ? 400 : 500;
    res.status(status).json({ error: code });
  }
});
app.post('/api/sms/unsubscribe', authRequired, async (req, res) => {
  try { res.json({ ok: true, removed: await removePhoneSubscription(req.user.id) }); }
  catch (error) { console.error('[sms] unsubscribe failed:', error.message || error); res.status(500).json({ error: 'sms_unsubscribe_failed' }); }
});

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

// ===== Owner production metrics (read-only) =====
app.get('/api/owner/metrics', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    res.json(await getOwnerMetrics());
  } catch (error) {
    console.error('[owner-metrics] route failed:', error.message || error);
    res.status(500).json({ error: 'owner_metrics_unavailable' });
  }
});

// ===== Owner user directory + conversation viewer (read-only, owner-gated) =====
// The directory (who to check on) and the conversations behind each user
// read straight from users/conversations/messages, already stored. Voice
// returns empty unless VOICE_TRANSCRIPTS=1.
app.get('/api/owner/users', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const minutes = Number(req.query.minutes) || 43200;
    const limit = Number(req.query.limit) || 100;
    res.json(await listUsers({ minutes, limit }));
  } catch (error) {
    console.error('[owner-conversations] users failed:', error.message || error);
    res.status(500).json({ error: 'owner_users_unavailable' });
  }
});

app.get('/api/owner/activity', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    res.json(await getActivitySummary());
  } catch (error) {
    console.error('[owner-conversations] activity failed:', error.message || error);
    res.status(500).json({ error: 'owner_activity_unavailable' });
  }
});

app.get('/api/owner/search', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    res.json(await searchConversations(req.query.q, { limit: Number(req.query.limit) || 40 }));
  } catch (error) {
    console.error('[owner-conversations] search failed:', error.message || error);
    res.status(500).json({ error: 'owner_search_unavailable' });
  }
});

app.get('/api/owner/users/:id', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const found = await getUserConversations(req.params.id);
    if (!found) return res.status(404).json({ error: 'not_found' });
    res.json(found);
  } catch (error) {
    console.error('[owner-conversations] user read failed:', error.message || error);
    res.status(500).json({ error: 'owner_users_unavailable' });
  }
});

app.get('/api/owner/conversations', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const minutes = Number(req.query.minutes) || 1440;
    const limit = Number(req.query.limit) || 40;
    const [text, voice] = await Promise.all([
      listConversations({ minutes, limit }),
      listVoiceCalls({ minutes, limit }),
    ]);
    res.json({ ...text, voice, voiceEnabled: voiceTranscriptsEnabled() });
  } catch (error) {
    console.error('[owner-conversations] list failed:', error.message || error);
    res.status(500).json({ error: 'owner_conversations_unavailable' });
  }
});

app.get('/api/owner/conversations/:id', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const found = await getConversation(req.params.id);
    if (!found) return res.status(404).json({ error: 'not_found' });
    res.json(found);
  } catch (error) {
    console.error('[owner-conversations] read failed:', error.message || error);
    res.status(500).json({ error: 'owner_conversations_unavailable' });
  }
});

app.get('/api/owner/voice/:sessionKey', authRequired, async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const found = await getVoiceCall(req.params.sessionKey);
    if (!found) return res.status(404).json({ error: 'not_found' });
    res.json(found);
  } catch (error) {
    console.error('[owner-conversations] voice read failed:', error.message || error);
    res.status(500).json({ error: 'owner_conversations_unavailable' });
  }
});

// The browser posts Realtime transcripts here as they arrive. Any signed-in
// user may post their OWN turns - the userId is taken from the token, never
// from the body - and the whole route is inert unless VOICE_TRANSCRIPTS=1.
app.post('/api/voice/transcript', authRequired, async (req, res) => {
  try {
    const result = await recordVoiceTurn({
      userId: req.user?.id || null,
      sessionKey: req.body?.sessionKey,
      role: req.body?.role,
      content: req.body?.content,
    });
    res.json(result);
  } catch (error) {
    console.error('[owner-conversations] transcript post failed:', error.message || error);
    res.status(500).json({ error: 'transcript_unavailable' });
  }
});


// ===== Realtime voice =====
const MAX_SESSION_SECONDS = Number(process.env.VOICE_MAX_SESSION_SECONDS || 600);
const PAID_SESSION_LIMIT = Number(process.env.VOICE_SESSIONS_PRO || 40);
const FREE_SESSION_LIMIT = Number(process.env.VOICE_SESSIONS_FREE || 1);
const GLOBAL_SESSION_LIMIT = Number(process.env.VOICE_SESSIONS_GLOBAL || 120);
const PAID_MINUTE_LIMIT = Number(process.env.VOICE_MINUTES_PRO || 200);
const FREE_MINUTE_LIMIT = Number(process.env.VOICE_MINUTES_FREE || 10);
const TRIAL_SESSION_LIMIT = Number(process.env.VOICE_SESSIONS_TRIAL || 10);
const TRIAL_MINUTE_LIMIT = Number(process.env.VOICE_MINUTES_TRIAL || 40);
const GLOBAL_MINUTE_LIMIT = Number(process.env.VOICE_MINUTES_GLOBAL || 5000);

app.get('/api/speech/token', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'sign_in_required', message: 'Sign in to talk with Mike.' });
    const paidAccess = hasPaidAccess(req.user);
    const trialAccess = paidAccess && isTrialSubscriber(req.user);
    const sessionLimit = trialAccess ? TRIAL_SESSION_LIMIT : paidAccess ? PAID_SESSION_LIMIT : FREE_SESSION_LIMIT;
    const minuteLimit = trialAccess ? TRIAL_MINUTE_LIMIT : paidAccess ? PAID_MINUTE_LIMIT : FREE_MINUTE_LIMIT;
    const ownerVoiceQa = isOwner(req.user);
    const outOfBudget = () => res.status(402).json({
      error: paidAccess ? 'voice_allowance_reached' : 'upgrade_required',
      message: trialAccess ? "That's the voice time included in your free trial. Subscribe for the full monthly allowance." : paidAccess ? "You've used this month's voice time. It resets on a rolling 30-day window." : 'Start your free trial to talk with Mike.',
    });

    const secondsAllowance = minuteLimit * 60;
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

    const secondsUsed = ownerVoiceQa ? 0 : await countVoiceSeconds(req.user.id, MAX_SESSION_SECONDS);
    res.json({
      ...result,
      sessionKey,
      maxSessionSeconds: MAX_SESSION_SECONDS,
      minutesRemaining: ownerVoiceQa ? null : Math.max(0, Math.floor((secondsAllowance - secondsUsed) / 60)),
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
    if (!Number.isFinite(reported) || reported < 0) return res.status(400).json({ error: 'seconds_invalid' });
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
      trialMinutes: TRIAL_MINUTE_LIMIT,
      trialSessions: TRIAL_SESSION_LIMIT,
      freeMinutes: FREE_MINUTE_LIMIT,
      globalMinutes: GLOBAL_MINUTE_LIMIT,
      paidSessions: PAID_SESSION_LIMIT,
      globalSessions: GLOBAL_SESSION_LIMIT,
    },
    accountsConfigured: authConfigured(),
    mailConfigured: mailerConfigured(),
    billingConfigured: billingConfigured(),
    model: OPENAI_MODEL,
    brain: getBrainStatus(),
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
    const tools = [...(owner ? LIVE_TOOLS : PUBLIC_TOOLS), { type: 'web_search_preview' }];
    const relevantMemories = req.user ? await getRelevantMemories(req.user.id, message, 12) : [];
    const instructions = (owner ? MIKE_INSTRUCTIONS : MIKE_INSTRUCTIONS + NON_OWNER_NOTE) + memoryPrompt(relevantMemories);
    let text = "I'm here. Give me another shot.";
    const REMINDER_TOOL_HANDLERS = req.user ? {
      set_reminder: (args) => setReminderTool(req.user.id, args),
      list_reminders: (args) => listRemindersTool(req.user.id, args),
      cancel_reminder: (args) => cancelReminderTool(req.user.id, args),
    } : {};
    const maxToolRounds = Math.max(1, Math.min(4, Number(process.env.MIKE_MAX_TOOL_ROUNDS || 3)));
    for (let round = 0; round < maxToolRounds; round += 1) {
      const roundTools = round === maxToolRounds - 1 ? [] : tools;
      const response = await generateBrainResponse({ client: openai, instructions, input, tools: roundTools, message });
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
                ? `Unknown tool \"${call.name}\".`
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
    const saved = await saveMemory(req.user.id, { category, memory, importance: req.body?.importance, source: req.body?.source || 'user' });
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
    /(^|\/)\.(env|git|svn|hg|aws|ssh|npmrc|htpasswd|s3cfg|travis|circleci|vscode|idea|DS_Store)(?:$|\/|\.)/i.test(req.path) ||
    /^\/(?:config\.json|secrets?\.json|credentials(?:\.json)?|aws[-_]credentials|aws\.json|appsettings(?:\.[\w-]+)?\.json|serviceaccountkey\.json|service[-_]account(?:\.json)?|firebase\.json|google-services\.json|web\.config|docker-compose\.ya?ml|dockerfile|wp-admin|wp-login\.php|phpmyadmin|server-status|actuator|telescope|trace\.axd)/i.test(req.path)
  ) return res.status(404).end();
  next();
});

// ===== Static + SPA fallback =====
const DIST_DIR = path.join(__dirname, '..', 'dist');
app.use('/assets', express.static(path.join(DIST_DIR, 'assets'), {
  maxAge: '1y',
  immutable: true,
  etag: false,
  dotfiles: 'deny',
}));
app.use(express.static(DIST_DIR, { maxAge: 0, etag: true, dotfiles: 'deny' }));
const SPA_ROUTES = new Set(['/']);
const SPA_ROUTE_PREFIXES = ['/app', '/login', '/register', '/forgot-password', '/reset-password', '/games', '/privacy', '/refunds', '/support'];
const isKnownSpaRoute = (pathname) => SPA_ROUTES.has(pathname) || SPA_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).json({ error: 'not_found' });
  if (!isKnownSpaRoute(req.path)) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.sendFile(path.join(DIST_DIR, 'index.html'));
});


const server = http.createServer(app);
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

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

  // Persistent account-scoped schedulers. Each worker is idempotent and
  // maintains its own database schema when needed.
  try {
    startReminderScheduler();
    console.log('[mike-ai] reminder scheduler ready');
  } catch (error) {
    console.error('[mike-ai] reminder scheduler initialization failed:', error.message || error);
  }
  try {
    startResaleWatchScheduler();
    console.log('[mike-ai] resale deal scanner ready');
  } catch (error) {
    console.error('[mike-ai] resale deal scanner initialization failed:', error.message || error);
  }
  try {
    startDealAlertScheduler();
    console.log('[mike-ai] deal alerts scheduler ready');
  } catch (error) {
    console.error('[mike-ai] deal alerts scheduler initialization failed:', error.message || error);
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[mike-ai] ${signal} received; draining HTTP connections`);
  const forceExit = setTimeout(() => {
    console.error('[mike-ai] graceful shutdown timed out; exiting');
    process.exit(1);
  }, 10_000);
  forceExit.unref();
  server.close(() => {
    clearTimeout(forceExit);
    console.log('[mike-ai] HTTP server drained; exiting');
    process.exit(0);
  });
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void shutdown(signal); });
