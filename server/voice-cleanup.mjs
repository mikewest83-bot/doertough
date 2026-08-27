// Automatic cleanup for abandoned realtime voice reservations.
// A reservation is settled after its full reserved duration has elapsed.
// This runs on startup and periodically so abandoned sessions cannot
// permanently consume the account/global voice allowance.

import { query } from './db.mjs';

export async function cleanupStaleVoiceSessions(maxSessionSeconds = 600) {
  if (!Number.isFinite(maxSessionSeconds) || maxSessionSeconds <= 0) return 0;

  const { rows } = await query(`
    UPDATE voice_sessions
       SET actual_seconds = LEAST(
             reserved_seconds,
             CEIL(EXTRACT(EPOCH FROM (now() - started_at)))::int
           ),
           ended_at = COALESCE(ended_at, now())
     WHERE actual_seconds IS NULL
       AND started_at < now() - make_interval(secs => reserved_seconds)
    RETURNING id
  `);

  if (rows.length) {
    console.log(`[speech-engine] reconciled ${rows.length} stale voice reservation(s)`);
  }

  return rows.length;
}

export function startVoiceCleanup(maxSessionSeconds = 600) {
  const run = async () => {
    try {
      await cleanupStaleVoiceSessions(maxSessionSeconds);
    } catch (error) {
      console.error('[speech-engine] stale-session cleanup failed:', error.message || error);
    }
  };

  void run();
  const timer = setInterval(run, 60_000);
  timer.unref?.();
  return timer;
}
