// Build-time, idempotent bridge for atomic voice reservation lifecycle.
// Keeps the existing token route behavior while replacing the race-prone
// preflight counters with a single transactional reservation decision.
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

const start = "    const usedSessions = await countVoiceSessions(req.user.id, MAX_SESSION_SECONDS);";
const end = "    res.json({\n      ...result,\n      sessionKey,\n      maxSessionSeconds: MAX_SESSION_SECONDS,\n      minutesRemaining: Math.max(0, Math.floor((secondsAllowance - secondsUsed) / 60)),\n    });";

if (!source.includes('const reserveResult = await reserveVoiceSession({')) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error('Voice token reservation route anchors not found');
  const replacement = `    const ownerVoiceQa = isOwner(req.user);\n    const secondsAllowance = minuteLimit * 60;\n\n    // The reservation itself is the authoritative admission decision. It is\n    // serialized in Postgres so concurrent token requests cannot both pass.\n    // Owner QA remains unlimited without weakening limits for customers.\n    const reservationLimits = ownerVoiceQa\n      ? {\n          accountSessionLimit: Number.MAX_SAFE_INTEGER,\n          accountSecondLimit: Number.MAX_SAFE_INTEGER,\n          globalSessionLimit: Number.MAX_SAFE_INTEGER,\n          globalSecondLimit: Number.MAX_SAFE_INTEGER,\n        }\n      : {\n          accountSessionLimit: sessionLimit,\n          accountSecondLimit: secondsAllowance,\n          globalSessionLimit: GLOBAL_SESSION_LIMIT,\n          globalSecondLimit: GLOBAL_MINUTE_LIMIT * 60,\n        };\n\n    const result = await getSpeechEngineToken();\n    const sessionKey = crypto.randomUUID();\n    const reserveResult = await reserveVoiceSession({\n      userId: req.user.id,\n      agentId: result.agentId,\n      sessionKey,\n      reservedSeconds: MAX_SESSION_SECONDS,\n      ...reservationLimits,\n    });\n\n    if (!reserveResult.ok) {\n      if (reserveResult.reason === 'account_session_limit' || reserveResult.reason === 'account_second_limit') {\n        return outOfBudget();\n      }\n      if (reserveResult.reason === 'global_session_limit' || reserveResult.reason === 'global_second_limit') {\n        console.error('[speech-engine] global ceiling hit during atomic reservation');\n        return res.status(503).json({\n          error: 'voice_capacity_reached',\n          message: 'Mike is at capacity right now. Try again a bit later.',\n        });\n      }\n      return res.status(503).json({ error: 'voice_reservation_failed' });\n    }\n\n`;
  source = source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

// The build-time bridge above has already removed the legacy startup migration
// call. Do not touch migration behavior here.
fs.writeFileSync(target, source);
console.log('[build] atomic voice reservation lifecycle integrated');
