// Build-time, idempotent bridge for atomic voice reservation lifecycle.
// Replaces the race-prone preflight with: reserve -> mint token -> release on failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(target, 'utf8');

const importLine = "import { reserveVoiceSession, releaseVoiceReservation } from './voice-reservations.mjs';";
if (!source.includes(importLine)) {
  const anchor = "} from './auth.mjs';";
  if (!source.includes(anchor)) throw new Error('Voice reservation import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

// Replace the entire speech-token route in one operation. This is deliberately
// route-scoped so repeated build patches cannot leave duplicate declarations
// such as sessionKey/result behind.
const routeStart = "app.get('/api/speech/token', async (req, res) => {";
const routeEnd = "\n\napp.post('/api/speech/session-end', authRequired, async (req, res) => {";
const startIndex = source.indexOf(routeStart);
const endIndex = startIndex >= 0 ? source.indexOf(routeEnd, startIndex) : -1;
if (startIndex < 0 || endIndex < 0) throw new Error('Voice token route anchors not found');

const hardenedRoute = `app.get('/api/speech/token', async (req, res) => {
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
});`;

source = source.slice(0, startIndex) + hardenedRoute + source.slice(endIndex);

fs.writeFileSync(target, source);
console.log('[build] atomic voice reservation lifecycle integrated');
