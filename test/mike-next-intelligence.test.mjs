import { strict as assert } from 'node:assert';
import { NEXT_INTELLIGENCE_TOOLS, negotiationCoach, purchaseScore, rememberPreference, forgetPreference } from '../server/mike-next-intelligence.mjs';

describe('Mike next intelligence', () => {
  it('exposes memory, negotiation, and purchase score tools', () => {
    assert.deepEqual(NEXT_INTELLIGENCE_TOOLS.map((tool) => tool.name), [
      'remember_preference', 'forget_preference', 'negotiation_coach', 'purchase_score',
    ]);
  });

  it('requires explicit consent for memory writes', () => {
    const result = rememberPreference({ key: 'negotiation target', value: '$25,000' });
    assert.equal(result.status, 'ready_to_save');
    assert.match(result.consentRule, /explicitly asks/i);
    assert.equal(forgetPreference({ key: 'negotiation target' }).status, 'ready_to_forget');
  });

  it('creates a negotiation plan without inventing market facts', () => {
    const result = negotiationCoach({ item: 'truck', askingPrice: 28000, targetPrice: 25000 });
    assert.equal(result.askingPrice, 28000);
    assert.equal(result.targetPrice, 25000);
    assert.equal(result.suggestedOpening, 23750);
    assert.match(result.dataRule, /verified market prices/i);
  });

  it('scores only supplied components and preserves affordability', () => {
    const result = purchaseScore({
      askingPrice: 28000,
      availableCash: 40000,
      upcomingExpenses: 5000,
      safetyBuffer: 5000,
      valueScore: 90,
      riskScore: 20,
      dealScore: 80,
    });
    assert.equal(result.score, 83);
    assert.equal(result.affordability.status, 'affordable');
    assert.equal(result.targetPrice, null);
  });

  it('does not manufacture a score when facts are missing', () => {
    const result = purchaseScore({ askingPrice: 28000 });
    assert.equal(result.score, null);
    assert.equal(result.affordability, null);
  });
});
