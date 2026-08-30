// Owner Code Mode
//
// Policy layer for owner-authorized coding requests. This module does not
// contain credentials and does not execute arbitrary shell commands. It
// enforces a review-first flow: inspect -> draft -> validate -> PR -> owner
// approval -> merge/deploy through the normal production gates.

const ALLOWED_PREFIXES = ['server/', 'src/', 'public/'];
const ALLOWED_ROOT_FILES = new Set([
  'package.json', 'index.html', 'README.md',
  'privacy.html', 'terms.html', 'refunds.html', 'support.html',
]);
const DENY_PATTERN = /(^|[/.])(\.env|secrets?|credentials?)([/.]|$)|(?:^|[^a-z])(?:api[_-]?key|access[_-]?token|private[_-]?key)(?:[^a-z]|$)/i;

export const OWNER_CODE_MODE_VERSION = '1.0.0';

export function isAllowedCodePath(path) {
  const p = String(path || '').trim();
  if (!p || p.includes('..') || p.startsWith('/') || p.startsWith('.github/')) return false;
  if (DENY_PATTERN.test(p)) return false;
  return ALLOWED_ROOT_FILES.has(p) || ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

export function authorizeOwnerCodeRequest({ isOwner, path } = {}) {
  if (!isOwner) return { allowed: false, reason: 'Owner permission is required.' };
  if (!isAllowedCodePath(path)) return { allowed: false, reason: 'That path is outside Owner Code Mode.' };
  return { allowed: true };
}

export function codeChangePlan({ isOwner, path, description } = {}) {
  const auth = authorizeOwnerCodeRequest({ isOwner, path });
  if (!auth.allowed) return auth;
  return {
    allowed: true,
    mode: 'owner_code_mode',
    version: OWNER_CODE_MODE_VERSION,
    path,
    description: String(description || '').slice(0, 500),
    workflow: ['inspect', 'draft', 'validate', 'pull_request', 'owner_approval', 'merge', 'deploy'],
    productionDirectWrite: false,
  };
}

export const OWNER_CODE_MODE_RULES = Object.freeze({
  ownerOnly: true,
  reviewRequired: true,
  pullRequestRequired: true,
  productionDirectWrite: false,
  secretsReadable: false,
  arbitraryShell: false,
  allowedPaths: [...ALLOWED_PREFIXES, ...ALLOWED_ROOT_FILES],
});
