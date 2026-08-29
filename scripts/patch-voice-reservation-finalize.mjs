import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Add the transaction helper to the existing DB module without changing its
// public schema or startup migration behavior.
const dbPath = path.join(root, 'server', 'db.mjs');
let db = fs.readFileSync(dbPath, 'utf8');
if (!db.includes('export async function withTransaction(')) {
  const anchor = "export async function query(text, params = []) {\n  if (!pool) throw new Error('database_not_configured');\n  return pool.query(text, params);\n}\n";
  if (!db.includes(anchor)) throw new Error('DB query anchor not found');
  const helper = `${anchor}\nexport async function withTransaction(fn) {\n  if (!pool) throw new Error('database_not_configured');\n  const client = await pool.connect();\n  try {\n    await client.query('BEGIN');\n    const result = await fn(client);\n    await client.query('COMMIT');\n    return result;\n  } catch (error) {\n    try { await client.query('ROLLBACK'); } catch {}\n    throw error;\n  } finally {\n    client.release();\n  }\n}\n`;
  db = db.replace(anchor, helper);
  fs.writeFileSync(dbPath, db);
}

// The earlier bridge creates the reservation decision. This finalizer makes
// the order correct: reserve first, then mint the OpenAI client secret. If
// OpenAI fails, release the reservation so a transient provider failure does
// not consume the user's allowance.
const indexPath = path.join(root, 'server', 'index.mjs');
let source = fs.readFileSync(indexPath, 'utf8');

const tokenFirst = `    const result = await getSpeechEngineToken();\n    const sessionKey = crypto.randomUUID();\n    const reserveResult = await reserveVoiceSession({`;
if (source.includes(tokenFirst)) {
  const blockStart = source.indexOf(tokenFirst);
  const failureMarker = "    if (!reserveResult.ok) {";
  const failureStart = source.indexOf(failureMarker, blockStart);
  if (failureStart < 0) throw new Error('Reservation failure block not found');

  let depth = 0;
  let inBlock = false;
  let blockEnd = -1;
  for (let i = failureStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') { depth += 1; inBlock = true; }
    else if (ch === '}' && inBlock) {
      depth -= 1;
      if (depth === 0) { blockEnd = i + 1; break; }
    }
  }
  if (blockEnd < 0) throw new Error('Reservation failure block end not found');

  const next = source.indexOf('\n\n', blockEnd);
  if (next < 0) throw new Error('Reservation block separator not found');

  const replacement = `    const sessionKey = crypto.randomUUID();\n    const agentId = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';\n    const reserveResult = await reserveVoiceSession({\n      userId: req.user.id,\n      agentId,\n      sessionKey,\n      reservedSeconds: MAX_SESSION_SECONDS,\n      ...reservationLimits,\n    });\n\n    if (!reserveResult.ok) {\n      if (reserveResult.reason === 'account_session_limit' || reserveResult.reason === 'account_second_limit') {\n        return outOfBudget();\n      }\n      if (reserveResult.reason === 'global_session_limit' || reserveResult.reason === 'global_second_limit') {\n        console.error('[speech-engine] global ceiling hit during atomic reservation');\n        return res.status(503).json({\n          error: 'voice_capacity_reached',\n          message: 'Mike is at capacity right now. Try again a bit later.',\n        });\n      }\n      return res.status(503).json({ error: 'voice_reservation_failed' });\n    }\n\n    let result;\n    try {\n      result = await getSpeechEngineToken();\n    } catch (error) {\n      try {\n        await releaseVoiceReservation(sessionKey, req.user.id);\n      } catch (releaseError) {\n        console.error('[speech-engine] failed to release reservation after token failure:', releaseError.message || releaseError);\n      }\n      throw error;\n    }`;

  source = source.slice(0, blockStart) + replacement + source.slice(next);
}

// Guard against the legacy non-atomic preflight surviving a future patch.
if (source.includes('const usedSessions = await countVoiceSessions(req.user.id, MAX_SESSION_SECONDS);')) {
  throw new Error('Legacy voice reservation preflight remains after finalization');
}

fs.writeFileSync(indexPath, source);
console.log('[build] atomic voice reservation order and failure cleanup finalized');
