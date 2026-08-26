import { expect } from 'chai';
import { createUser, recordVoiceSession, closeVoiceSession, countVoiceSeconds, countVoiceSessions, countVoiceSessionsGlobal, countVoiceSecondsGlobal, query } from '../server/db.mjs';
import { withTransaction } from './support/tx-fixture.mjs';

describe('voice session accounting', function () {
  before(function () {
    if (!process.env.DATABASE_URL) this.skip();
  });

  it('records and closes a session (transactional where practical)', async function () {
    await withTransaction(async () => {
      const user = await createUser({ email: `voice-test+${Date.now()}@example.com`, name: 'Voice Test', passwordHash: 'test-hash' });
      const s = await recordVoiceSession(user.id, 'engine-test', { sessionKey: `key-${Date.now()}`, reservedSeconds: 60 });
      expect(s).to.have.property('id');
      expect(s.user_id).to.equal(user.id);

      const closed = await closeVoiceSession(s.session_key, user.id, 1);
      expect(closed).to.have.property('id');
      expect(closed.user_id).to.equal(user.id);

      const seconds = await countVoiceSeconds(user.id);
      expect(Number.isInteger(seconds)).to.be.true;
      const sessions = await countVoiceSessions(user.id);
      expect(Number.isInteger(sessions)).to.be.true;
    });
  });

  it('concurrent closeVoiceSession only allows one success', async function () {
    if (!process.env.DATABASE_URL) this.skip();

    const user = await createUser({ email: `voice-concurrent+${Date.now()}@example.com`, name: 'Voice Concurrent', passwordHash: 'test-hash' });
    const s = await recordVoiceSession(user.id, 'engine-test', { sessionKey: `concurrent-key-${Date.now()}`, reservedSeconds: 3600 });

    try {
      const [r1, r2] = await Promise.all([
        closeVoiceSession(s.session_key, user.id, 10),
        closeVoiceSession(s.session_key, user.id, 20),
      ]);

      const successes = [r1, r2].filter(Boolean);
      expect(successes.length).to.equal(1);

      const closed = successes[0];
      expect(closed).to.have.property('actual_seconds');
      expect(Number.isInteger(closed.actual_seconds)).to.be.true;
      expect(closed.user_id).to.equal(user.id);
    } finally {
      await query('DELETE FROM users WHERE id = $1', [user.id]);
    }
  });

  it('concurrent reservations create separate rows (does not prove budget gating)', async function () {
    if (!process.env.DATABASE_URL) this.skip();

    const keys = [`resv-${Date.now()}-1`, `resv-${Date.now()}-2`];
    const results = await Promise.all([
      recordVoiceSession(null, 'engine-test', { sessionKey: keys[0], reservedSeconds: 600 }),
      recordVoiceSession(null, 'engine-test', { sessionKey: keys[1], reservedSeconds: 600 }),
    ]);

    expect(results.length).to.equal(2);
    expect(results[0]).to.have.property('id');
    expect(results[1]).to.have.property('id');

    const globalSessions = await countVoiceSessionsGlobal();
    const globalSeconds = await countVoiceSecondsGlobal();
    expect(Number.isInteger(globalSessions)).to.be.true;
    expect(Number.isInteger(globalSeconds)).to.be.true;

    await query('DELETE FROM voice_sessions WHERE session_key = ANY($1)', [keys]);
  });
});
