import { strict as assert } from 'node:assert';
import { NEXT_INTELLIGENCE_TOOLS, NEXT_INTELLIGENCE_HANDLERS } from '../server/mike-next-intelligence.mjs';

describe('Mike next intelligence integration contract', () => {
  it('has a handler for every exposed tool', () => {
    for (const tool of NEXT_INTELLIGENCE_TOOLS) assert.equal(typeof NEXT_INTELLIGENCE_HANDLERS[tool.name], 'function');
  });

  it('does not expose credentials or account secrets as parameters', () => {
    const forbidden = /password|token|secret|apiKey|plaid/i;
    for (const tool of NEXT_INTELLIGENCE_TOOLS) {
      for (const key of Object.keys(tool.parameters?.properties || {})) {
        assert.equal(forbidden.test(key), false, `${tool.name} exposes ${key}`);
      }
    }
  });
});
