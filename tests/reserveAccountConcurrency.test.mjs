import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { pool, createUser } from '../server/db.mjs';
import { reserveVoiceSession } from '../server/voiceReservations.mjs';

const db = () => {
  if (!pool) throw new Error('DATABASE_URL is required for voice reservation tests');
  return pool;
};

async function makeUser(email) {
  return createUser({ email, name: 'Voice Race Test', passwordHash: 'test-hash' });
}

describe('reserveVoiceSession account concurrency', () => {
  it('allows only one reservation when two calls race for the same account budget', async () => {
    const email = `voice-race-${Date.now()}-${Math.random()}@example.test`;
    const user = await makeUser(email);
    const [a, b] = await Promise.all([
      reserveVoiceSession({ userId: user.id, sessionKey: crypto.randomUUID(), reservedSeconds: 600 }),
      reserveVoiceSession({ userId: user.id, sessionKey: crypto.randomUUID(), reservedSeconds: 600 }),
    ]);

    assert.equal([a, b].filter((r) => r.reserved).length, 1);
    assert.equal([a, b].filter((r) => !r.reserved && r.reason === 'account_budget').length, 1);

    await db().query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});
