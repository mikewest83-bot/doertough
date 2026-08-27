import { query } from './db.mjs';

export async function cancelVoiceReservation(sessionKey, userId) {
  if (!sessionKey || !userId) return false;
  const { rowCount } = await query(
    `UPDATE voice_sessions
        SET actual_seconds = 0,
            ended_at = now()
      WHERE session_key = $1
        AND user_id = $2
        AND actual_seconds IS NULL`,
    [String(sessionKey), userId]
  );
  return rowCount > 0;
}
