import { expect } from 'chai';
import { reserveVoiceSession } from '../server/voice-reservations.mjs';
import { query } from '../server/db.mjs';

describe('atomic voice reservations', function () {
  before(function () {
    if (!process.env.DATABASE_URL) this.skip();
  });

  it('serializes concurrent reservations at the account session boundary', async function () {
    const prefix = `atomic-${Date.now()}`;
    const options = {
      userId: null,
      agentId: 'atomic-test',
      reservedSeconds: 600,
      accountSessionLimit: 1,
      accountSecondLimit: 600,
      globalSessionLimit: 1000,
      globalSecondLimit: 600000,
    };
    const [a, b] = await Promise.all([
      reserveVoiceSession({ ...options, sessionKey: `${prefix}-a` }),
      reserveVoiceSession({ ...options, sessionKey: `${prefix}-b` }),
    ]);

    expect([a, b].filter((result) => result.ok)).to.have.length(1);
    expect([a, b].filter((result) => !result.ok)).to.have.length(1);
    await query('DELETE FROM voice_sessions WHERE session_key LIKE $1', [`${prefix}%`]);
  });
});
