import { strict as assert } from 'node:assert';
import { DOERTOUGH_INTELLIGENCE_TOOLS } from '../server/doertough-intelligence-tools.mjs';

const names = DOERTOUGH_INTELLIGENCE_TOOLS.map((tool) => tool.name);

describe('Doer Tough intelligence bridge', () => {
  it('exposes DealTough and Money capability tools', () => {
    assert.ok(names.includes('analyze_purchase_with_dealtough'));
    assert.ok(names.includes('use_doertough_money_intelligence'));
  });

  it('requires a category and asking price for DealTough analysis', () => {
    const tool = DOERTOUGH_INTELLIGENCE_TOOLS.find((item) => item.name === 'analyze_purchase_with_dealtough');
    assert.deepEqual(tool.parameters.required, ['category', 'askingPrice']);
  });

  it('does not expose bank or Plaid credentials as tool parameters', () => {
    const serialized = JSON.stringify(DOERTOUGH_INTELLIGENCE_TOOLS).toLowerCase();
    assert.equal(serialized.includes('plaid'), false);
    assert.equal(serialized.includes('bank_password'), false);
  });
});
