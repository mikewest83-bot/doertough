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

const legacyStart = "    const usedSessions = await countVoiceSessions(req.user.id, MAX_SESSION_SECONDS);";
const hardenedStart = "    const secondsAllowance = minuteLimit * 60;";
const resultMarker = "    const result = await getSpeechEngineToken();";

if (!source.includes('const reserveResult = await reserveVoiceSession({')) {
  const legacyIndex = source.indexOf(legacyStart);
  const hardenedIndex = source.indexOf(hardenedStart);
  const startIndex = legacyIndex >= 0 ? legacyIndex : hardenedIndex;
  const endIndex = source.indexOf(resultMarker, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error('Voice token reservation route anchors not found');

  const replacement = `    // ownerVoiceQa is installed once by patch-index-realtime-tools.mjs.\n    // Reuse it here rather than redeclaring the const in the same route scope.\n    const secondsAllowance = minuteLimit * 60;\n\n    // The reservation is the authoritative admission decision. PostgreSQL\n    // serializes it so concurrent token requests cannot both pass the budget.\n    const reservationLimits = ownerVoiceQa\n      ? { accountSessionLimit: Number.MAX_SAFE_INTEGER, accountSecondLimit: Number.MAX_SAFE_INTEGER, globalSessionLimit: Number.MAX_SAFE_INTEGER, globalSecondLimit: Number.MAX_SAFE_INTEGER }\n      : { accountSessionLimit: sessionLimit, accountSecondLimit: secondsAllowance, globalSessionLimit: GLOBAL_SESSION_LIMIT, globalSecondLimit: GLOBAL_MINUTE_LIMIT * 60 };\n\n    const sessionKey = crypto.randomUUID();\n    const agentId = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';\n    const reserveResult = await reserveVoiceSession({\n      userId: req.user.id,\n      agentId,\n      sessionKey,\n      reservedSeconds: MAX_SESSION_SECONDS,\n      ...reservationLimits,\n    });\n\n    if (!reserveResult.ok) {\n      if (reserveResult.reason === 'account_session_limit' || reserveResult.reason === 'account_second_limit') return outOfBudget();\n      if (reserveResult.reason === 'global_session_limit' || reserveResult.reason === 'global_second_limit') {\n        console.error('[speech-engine] global ceiling hit during atomic reservation');\n        return res.status(503).json({ error: 'voice_capacity_reached', message: 'Mike is at capacity right now. Try again a bit later.' });\n      }\n      return res.status(503).json({ error: 'voice_reservation_failed' });\n    }\n\n    let result;\n    try {\n      result = await getSpeechEngineToken();\n    } catch (error) {\n      try { await releaseVoiceReservation(sessionKey, req.user.id); }\n      catch (releaseError) { console.error('[speech-engine] failed to release reservation after token failure:', releaseError.message || releaseError); }\n      throw error;\n    }\n\n`;
  source = source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

if (source.includes('const usedSessions = await countVoiceSessions(req.user.id, MAX_SESSION_SECONDS);')) {
  throw new Error('Legacy voice reservation preflight remains after finalization');
}

source = source.replace(
  'minutesRemaining: Math.max(0, Math.floor((secondsAllowance - secondsUsed) / 60)),',
  'minutesRemaining: Math.max(0, Math.floor((secondsAllowance - MAX_SESSION_SECONDS) / 60)),',
);

fs.writeFileSync(target, source);
console.log('[build] atomic voice reservation lifecycle integrated');
