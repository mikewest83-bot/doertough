import { expect } from 'chai';
import crypto from 'crypto';
import { createUser, createPasswordReset, findPasswordReset, consumePasswordReset, query } from '../server/db.mjs';
import { withTransaction } from './support/tx-fixture.mjs';

describe('password reset flow', function () {
  before(function () {
    if (!process.env.DATABASE_URL) this.skip();
  });

  it('creates a user and consumes reset token (happy path)', async function () {
    await withTransaction(async () => {
      const user = await createUser({ email: `test+${Date.now()}@example.com`, name: 'T', passwordHash: 'oldhash' });
      expect(user).to.have.property('id');

      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

      const reset = await createPasswordReset(user.id, tokenHash, expiresAt);
      expect(reset).to.have.property('id');

      const found = await findPasswordReset(tokenHash);
      expect(found).to.not.be.null;

      const updatedUser = await consumePasswordReset(reset.id, user.id, 'newhash');
      expect(updatedUser).to.have.property('password_hash', 'newhash');

      const second = await consumePasswordReset(reset.id, user.id, 'another');
      expect(second).to.be.null;
    });
  });

  it('concurrent consumePasswordReset only allows one success', async function () {
    if (!process.env.DATABASE_URL) this.skip();

    // Use real DB rows (no transaction rollback) to exercise concurrency across connections.
    const user = await createUser({ email: `concurrent+${Date.now()}@example.com`, name: 'C', passwordHash: 'oldhash' });
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

    const reset = await createPasswordReset(user.id, tokenHash, expiresAt);

    // Run two concurrent consumers using separate connections.
    const [r1, r2] = await Promise.all([
      consumePasswordReset(reset.id, user.id, 'hash1'),
      consumePasswordReset(reset.id, user.id, 'hash2'),
    ]);

    const successes = [r1, r2].filter(Boolean);
    expect(successes.length).to.equal(1);

    // Verify token_version incremented exactly once.
    const { rows } = await query('SELECT token_version, password_hash FROM users WHERE id = $1', [user.id]);
    expect(Number(rows[0].token_version)).to.equal(1);
  });
});
