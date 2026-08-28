import { strict as assert } from 'node:assert';
import { saveMeMoney, secondOpinion, getMeABetterDeal } from '../server/money-tools.mjs';
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
