import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import {
  authorizeOwnerCodeRequest,
  codeChangePlan,
  isAllowedCodePath,
} from '../server/owner-code-mode.mjs';

describe('Owner Code Mode', () => {
  it('requires owner permission', () => {
    assert.equal(authorizeOwnerCodeRequest({ isOwner: false, path: 'src/main.jsx' }).allowed, false);
    assert.equal(authorizeOwnerCodeRequest({ isOwner: true, path: 'src/main.jsx' }).allowed, true);
  });

  it('rejects secrets and GitHub workflow files', () => {
    assert.equal(isAllowedCodePath('.env'), false);
    assert.equal(isAllowedCodePath('server/api-key.mjs'), false);
    assert.equal(isAllowedCodePath('.github/workflows/ci.yml'), false);
  });

  it('requires review and a PR before production', () => {
    const plan = codeChangePlan({
      isOwner: true,
      path: 'server/persona.mjs',
      description: 'Update Mike personality behavior',
    });
    assert.deepEqual(plan.workflow, [
      'inspect', 'draft', 'validate', 'pull_request', 'owner_approval', 'merge', 'deploy',
    ]);
    assert.equal(plan.productionDirectWrite, false);
  });
});
