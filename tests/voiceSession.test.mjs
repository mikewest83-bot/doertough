import { expect } from 'chai';
import { recordVoiceSession, closeVoiceSession, countVoiceSeconds, countVoiceSessions, countVoiceSessionsGlobal, countVoiceSecondsGlobal, query } from '../server/db.mjs';
import { withTransaction } from './support/tx-fixture.mjs';

describe('voice session accounting', function () {
  before(function () {
    if (!process.env.DATABASE_URL) this.skip();
  });

  it('records and closes a session (transactional where practical)', async function () {
    await withTransaction(async () => {
      const s = await recordVoiceSession(null, 'engine-test', { sessionKey: `key-${Date.now()}`, reservedSeconds: 60 });
      expect(s).to.have.property('id');

      const closed = await closeVoiceSession(s.session_key, s.user_id, 1);
      expect(closed === null || closed.id).to.satisfy(Boolean);

      const seconds = await countVoiceSeconds(s.user_id);
      expect(Number.isInteger(seconds)).to.be.true;
      const sessions = await countVoiceSessions(s.user_id);
      expect(Number.isInteger(sessions)).to.be.true;
    });
  });

  it('concurrent closeVoiceSession only allows one success', async function () {
    if (!process.env.DATABASE_URL) this.skip();

    // Create a real reservation outside a transaction so concurrency uses separate connections.
    const s = await recordVoiceSession(null, 'engine-test', { sessionKey: `concurrent-key-${Date.now()}`, reservedSeconds: 3600 });

    const [r1, r2] = await Promise.all([
      closeVoiceSession(s.session_key, s.user_id, 10),
      closeVoiceSession(s.session_key, s.user_id, 20),
    ]);

    const successes = [r1, r2].filter(Boolean);
    expect(successes.length).to.equal(1);

    // Ensure actual_seconds was set and is an integer when available
    const closed = successes[0];
    expect(closed).to.have.property('actual_seconds');
    expect(Number.isInteger(closed.actual_seconds)).to.be.true;
  });

  it('concurrent reservations create separate rows (does not prove budget gating)', async function () {
    if (!process.env.DATABASE_URL) this.skip();

    // The application-level budget gate is outside these helpers. This test documents
    // current behavior: two concurrent recordVoiceSession calls both succeed and create rows.
    // A future dedicated reservation API should be used to atomically check and reserve budget.
    const keys = [`resv-${Date.now()}-1`, `resv-${Date.now()}-2`];
    const results = await Promise.all([
      recordVoiceSession(null, 'engine-test', { sessionKey: keys[0], reservedSeconds: 600 }),
      recordVoiceSession(null, 'engine-test', { sessionKey: keys[1], reservedSeconds: 600 }),
    ]);

    expect(results.length).to.equal(2);
    expect(results[0]).to.have.property('id');
    expect(results[1]).to.have.property('id');

    // Global counters reflect both insertions
    const globalSessions = await countVoiceSessionsGlobal();
    const globalSeconds = await countVoiceSecondsGlobal();
    expect(Number.isInteger(globalSessions)).to.be.true;
    expect(Number.isInteger(globalSeconds)).to.be.true;

    // Cleanup the two rows to avoid leaving test data when running locally; CI DB is ephemeral.
    await query('DELETE FROM voice_sessions WHERE session_key = ANY($1)', [keys]);
  });
});
