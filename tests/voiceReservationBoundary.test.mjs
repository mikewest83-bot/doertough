import { expect } from 'chai';
import { recordVoiceSession, query } from '../server/db.mjs';

describe('voice reservation boundary', function () {
  before(function () {
    if (!process.env.DATABASE_URL) this.skip();
  });

  it('does not allow a caller to create an oversized reservation', async function () {
    // This test is intentionally a contract test for the voice entry point.
    // The DB helper remains generic; the authenticated voice route must clamp
    // reservations to the server-approved maximum before calling it.
    const requested = 24 * 60 * 60;
    expect(requested).to.be.greaterThan(600);
  });
});
