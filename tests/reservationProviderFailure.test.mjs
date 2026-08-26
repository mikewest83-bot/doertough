import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { pool, createUser } from '../server/db.mjs';
import { reserveVoiceSession, cancelReservation } from '../server/voiceReservations.mjs';

describe('voice reservation provider failure', () => {
  it('releases a reservation when provider acquisition fails', async () => {
    const user = await createUser({
      email: `provider-failure-${Date.now()}-${Math.random()}@example.test`,
      name: 'Provider Failure Test',
      passwordHash: 'test-hash',
    });

    const reserved = await reserveVoiceSession({
      userId: user.id,
      sessionKey: crypto.randomUUID(),
      reservedSeconds: 600,
    });
    assert.equal(reserved.reserved, true);

    // The route will call this operation when getSpeechEngineToken() throws
    // or times out. Keep the database behavior directly testable here.
    const cancelled = await cancelReservation(reserved.session.id);
    assert.ok(cancelled);
    assert.equal(cancelled.actual_seconds, 0);
    assert.ok(cancelled.ended_at);

    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(actual_seconds, reserved_seconds)), 0)::int AS seconds
         FROM voice_sessions WHERE user_id = $1`,
      [user.id]
    );
    assert.equal(Number(rows[0].seconds), 0);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});
