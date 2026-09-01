import assert from 'node:assert/strict';
import { resolveBrain, complexityScore } from './brain-router.mjs';

describe('brain router', () => {
  it('starts automatic routing on mini even for complex-looking prompts', () => {
    assert.equal(resolveBrain({ message: 'Compare these contracts, build a financial model, audit the architecture, and explain the trade-offs.' , requested: 'auto' }), 'mini');
  });

  it('preserves explicit brain selection', () => {
    assert.equal(resolveBrain({ message: 'hello', requested: 'mini' }), 'mini');
    assert.equal(resolveBrain({ message: 'hello', requested: 'terra' }), 'terra');
  });

  it('still computes complexity as diagnostic information', () => {
    assert.ok(complexityScore('audit the architecture and build a financial model') > 0);
  });
});
