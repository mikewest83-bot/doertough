import assert from 'node:assert/strict';
import { describe, it } from 'mocha';

process.env.VOICE_MINUTES_GLOBAL = '10';

const { pool, createUser } = await import('../server/db.mjs');
const { reserveVoiceSession } = await import('../server/voiceReservations.mjs');

async function makeUser(email) {
  return createUser({ email, name: 'Global Race Test', passwordHash: 'test-hash' });
}

describe('reserveVoiceSession global concurrency', () => {
  it('allows at most one full reservation when the global minute pool has only one session left', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const userA = await makeUser(`global-race-a-${suffix}@example.test`);
    const userB = await makeUser(`global-race-b-${suffix}@example.test`);

    const [a, b] = await Promise.all([
      reserveVoiceSession({ userId: userA.id, sessionKey: crypto.randomUUID(), reservedSeconds: 600 }),
      reserveVoiceSession({ userId: userB.id, sessionKey: crypto.randomUUID(), reservedSeconds: 600 }),
    ]);

    assert.equal([a, b].filter((r) => r.reserved).length, 1);
    assert.equal([a, b].filter((r) => !r.reserved && r.reason === 'global_budget').length, 1);

    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [userA.id, userB.id]);
  });
});
