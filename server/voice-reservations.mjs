import { query, withTransaction } from './db.mjs';

// Atomically check account/global voice budgets and create the reservation.
// The advisory transaction lock serializes reservations so concurrent requests
// cannot both pass the read-before-insert budget gate.
export async function reserveVoiceSession({ userId, agentId, sessionKey, reservedSeconds, accountSessionLimit, accountSecondLimit, globalSessionLimit, globalSecondLimit }) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['mike-ai:voice-reservation-budget']);

    const { rows: [usage] } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE user_id = $1)::int AS account_sessions,
        COALESCE(SUM(actual_seconds) FILTER (WHERE user_id = $1), 0)::int AS account_seconds,
        COUNT(*)::int AS global_sessions,
        COALESCE(SUM(actual_seconds), 0)::int AS global_seconds
      FROM voice_sessions
      WHERE started_at >= now() - interval '30 days'
    `, [userId]);

    if (usage.account_sessions >= accountSessionLimit) return { ok: false, reason: 'account_session_limit' };
    if (usage.account_seconds >= accountSecondLimit) return { ok: false, reason: 'account_second_limit' };
    if (usage.global_sessions >= globalSessionLimit) return { ok: false, reason: 'global_session_limit' };
    if (usage.global_seconds >= globalSecondLimit) return { ok: false, reason: 'global_second_limit' };

    const { rows: [row] } = await client.query(`
      INSERT INTO voice_sessions (user_id, agent_id, session_key, reserved_seconds)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [userId, agentId, sessionKey, reservedSeconds]);

    return { ok: true, row };
  });
}

export async function releaseVoiceReservation(sessionKey, userId) {
  const { rows } = await query(`
    DELETE FROM voice_sessions
     WHERE session_key = $1
       AND user_id = $2
       AND actual_seconds IS NULL
     RETURNING id
  `, [sessionKey, userId]);
  return rows[0] || null;
}
