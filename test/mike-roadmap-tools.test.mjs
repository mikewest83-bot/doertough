import { strict as assert } from 'node:assert';
import { saveMeMoney, purchaseAffordability, secondOpinion, getMeABetterDeal } from '../server/money-tools.mjs';
import { ROLES, PERMISSIONS, hasPermission, roleForUser } from '../server/rbac.mjs';

const owner = { id: 1, email: 'owner@example.com', role: 'user' };
const admin = { id: 2, email: 'admin@example.com', role: 'admin' };
const user = { id: 3, email: 'user@example.com', role: 'user' };
const isOwner = (candidate) => candidate?.email === owner.email;

describe('Mike roadmap tools', () => {
  it('calculates a monthly and annual savings baseline', () => {
    const result = saveMeMoney({ category: 'subscription', amount: 100, frequency: 'monthly' });
    assert.equal(result.monthlyCost, 100);
    assert.equal(result.annualCost, 1200);
    assert.equal(result.initialSavingsTarget, 10);
    assert.ok(result.nextSteps.length >= 4);
  });

  it('adds Even-derived affordability analysis without needing bank access', () => {
    const result = saveMeMoney({
      category: 'purchase',
      amount: 1200,
      frequency: 'one_time',
      availableCash: 5000,
      upcomingExpenses: 2500,
      safetyBuffer: 1000,
    });
    assert.equal(result.affordability.status, 'affordable_but_tight');
    assert.equal(result.affordability.spendableAfterUpcomingExpenses, 2500);
    assert.equal(result.affordability.remainingAfterPurchase, 1300);
    assert.equal(result.affordability.protectedRemaining, 300);
  });

  it('blocks an unaffordable purchase using only supplied facts', () => {
    const result = purchaseAffordability({
      availableCash: 2000,
      purchaseAmount: 1500,
      upcomingExpenses: 700,
    });
    assert.equal(result.status, 'not_affordable');
    assert.equal(result.remainingAfterPurchase, -200);
    assert.match(result.recommendation, /would not make the purchase/i);
  });

  it('does not invent affordability when required facts are missing', () => {
    const result = purchaseAffordability({ purchaseAmount: 1500 });
    assert.equal(result.status, 'insufficient_information');
    assert.equal(result.remainingAfterPurchase, null);
    assert.match(result.dataRule, /user-supplied/i);
  });

  it('does not invent market data for a better-deal plan', () => {
    const result = getMeABetterDeal({ item: 'used truck', askingPrice: 28000 });
    assert.equal(result.askingPrice, 28000);
    assert.equal(result.targetPrice, null);
    assert.match(result.dataRule, /current data/i);
  });

  it('returns a structured second opinion', () => {
    const result = secondOpinion({ decision: 'Buy the truck', concerns: ['price'] });
    assert.equal(result.tool, 'second_opinion');
    assert.ok(result.checklist.includes('What would change the recommendation?'));
  });
});

describe('Mike RBAC', () => {
  it('elevates only the authenticated owner account', () => {
    assert.equal(roleForUser(owner, isOwner), ROLES.OWNER);
    assert.equal(roleForUser(admin, isOwner), ROLES.ADMIN);
    assert.equal(roleForUser(user, isOwner), ROLES.USER);
  });

  it('keeps owner permissions above admin and user permissions', () => {
    assert.equal(hasPermission(owner, PERMISSIONS.DEPLOY, isOwner), true);
    assert.equal(hasPermission(admin, PERMISSIONS.DEPLOY, isOwner), false);
    assert.equal(hasPermission(user, PERMISSIONS.USE_MIKE, isOwner), true);
  });
});
