import { expect } from 'chai';
import { reserveVoiceSession } from '../server/voice-reservations.mjs';

describe('atomic voice reservations', function () {
  before(function () {
    if (!process.env.DATABASE_URL) this.skip();
  });

  it('serializes concurrent reservations at the budget boundary', async function () {
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
      reserveVoiceSession({ ...options, sessionKey: `atomic-${Date.now()}-a` }),
      reserveVoiceSession({ ...options, sessionKey: `atomic-${Date.now()}-b` }),
    ]);

    const successes = [a, b].filter((result) => result.ok);
    const rejected = [a, b].filter((result) => !result.ok);
    expect(successes.length).to.equal(1);
    expect(rejected.length).to.equal(1);
  });
});
