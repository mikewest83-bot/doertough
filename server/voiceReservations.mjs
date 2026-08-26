// Atomic reservation gate for Mike AI voice sessions.
import { pool, getUserById, hasPro } from './db.mjs';

const NAMESPACE = 0xC0FFEE;
const GLOBAL_KEY = 0;
const VOICE_SESSIONS_PRO = Number(process.env.VOICE_SESSIONS_PRO || 40);
const VOICE_SESSIONS_FREE = Number(process.env.VOICE_SESSIONS_FREE || 1);
const VOICE_SESSIONS_GLOBAL = Number(process.env.VOICE_SESSIONS_GLOBAL || 120);
const MAX_SESSION_SECONDS = Number(process.env.VOICE_MAX_SESSION_SECONDS || 600);
const VOICE_MINUTES_PRO = Number(process.env.VOICE_MINUTES_PRO || 200);
const VOICE_MINUTES_FREE = Number(process.env.VOICE_MINUTES_FREE || 10);
const VOICE_MINUTES_GLOBAL = Number(process.env.VOICE_MINUTES_GLOBAL || 5000);

const userLockKey = (userId) => {
  const n = Number(userId);
  if (!Number.isSafeInteger(n) || n <= 0 || n >= 2147483647) throw new Error('user_id_invalid');
  return n;
};

async function computeAllowances(userId) {
  const user = await getUserById(userId);
  if (!user) throw new Error('user_not_found');
  const pro = hasPro(user);
  return {
    sessionAllowance: pro ? VOICE_SESSIONS_PRO : VOICE_SESSIONS_FREE,
    minuteAllowanceSeconds: (pro ? VOICE_MINUTES_PRO : VOICE_MINUTES_FREE) * 60,
    globalSessionAllowance: VOICE_SESSIONS_GLOBAL,
    globalMinuteAllowanceSeconds: VOICE_MINUTES_GLOBAL * 60,
  };
}

export async function reserveVoiceSession({
  userId,
  engineId = null,
  sessionKey = null,
  reservedSeconds = MAX_SESSION_SECONDS,
} = {}) {
  if (!pool) throw new Error('database_not_configured');
  if (!userId) throw new Error('user_id_required');

  const seconds = Math.max(1, Math.min(MAX_SESSION_SECONDS, Math.round(Number(reservedSeconds) || 0)));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Always acquire the global lock before the user lock to prevent deadlocks.
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [NAMESPACE, GLOBAL_KEY]);
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [NAMESPACE, userLockKey(userId)]);

    const allowances = await computeAllowances(userId);
    const { rows } = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN user_id = $1 THEN COALESCE(actual_seconds, reserved_seconds) ELSE 0 END), 0)::int AS user_seconds,
         COALESCE(SUM(COALESCE(actual_seconds, reserved_seconds)), 0)::int AS global_seconds,
         COUNT(*) FILTER (WHERE user_id = $1)::int AS user_sessions,
         COUNT(*)::int AS global_sessions
       FROM voice_sessions
       WHERE started_at >= now() - interval '30 days'`,
      [userId]
    );
    const usage = rows[0];
    const userSeconds = Number(usage.user_seconds || 0);
    const globalSeconds = Number(usage.global_seconds || 0);
    const userSessions = Number(usage.user_sessions || 0);
    const globalSessions = Number(usage.global_sessions || 0);

    if (userSessions + 1 > allowances.sessionAllowance) {
      await client.query('ROLLBACK');
      return { reserved: false, reason: 'account_session_limit' };
    }
    if (globalSessions + 1 > allowances.globalSessionAllowance) {
      await client.query('ROLLBACK');
      return { reserved: false, reason: 'global_session_limit' };
    }
    if (userSeconds + seconds > allowances.minuteAllowanceSeconds) {
      await client.query('ROLLBACK');
      return { reserved: false, reason: 'account_budget' };
    }
    if (globalSeconds + seconds > allowances.globalMinuteAllowanceSeconds) {
      await client.query('ROLLBACK');
      return { reserved: false, reason: 'global_budget' };
    }

    const inserted = await client.query(
      `INSERT INTO voice_sessions (user_id, engine_id, session_key, reserved_seconds)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, engineId || null, sessionKey || null, seconds]
    );
    await client.query('COMMIT');
    return { reserved: true, session: inserted.rows[0] };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelReservation(sessionId) {
  if (!pool) throw new Error('database_not_configured');
  const { rows } = await pool.query(
    `UPDATE voice_sessions
        SET actual_seconds = 0,
            ended_at = now()
      WHERE id = $1
        AND actual_seconds IS NULL
      RETURNING *`,
    [sessionId]
  );
  return rows[0] || null;
}

export { MAX_SESSION_SECONDS };
