// Centralized role-based access control for Mike AI.
// Roles are server-side only. Never trust a role supplied by the browser.

export const ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
  OWNER: 'owner',
});

const ROLE_RANK = Object.freeze({ user: 10, admin: 50, owner: 100 });

export const PERMISSIONS = Object.freeze({
  USE_MIKE: 'mike.use',
  USE_SAVINGS_TOOLS: 'tools.savings',
  USE_PERSONAL_DATA: 'data.personal',
  MANAGE_USERS: 'users.manage',
  VIEW_USAGE: 'usage.view',
  MANAGE_TOOLS: 'tools.manage',
  MANAGE_BILLING: 'billing.manage',
  MANAGE_SECURITY: 'security.manage',
  DEPLOY: 'deploy.manage',
});

const ROLE_PERMISSIONS = Object.freeze({
  user: new Set([
    PERMISSIONS.USE_MIKE,
    PERMISSIONS.USE_SAVINGS_TOOLS,
    PERMISSIONS.USE_PERSONAL_DATA,
  ]),
  admin: new Set([
    PERMISSIONS.USE_MIKE,
    PERMISSIONS.USE_SAVINGS_TOOLS,
    PERMISSIONS.USE_PERSONAL_DATA,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.VIEW_USAGE,
    PERMISSIONS.MANAGE_TOOLS,
  ]),
  owner: new Set(Object.values(PERMISSIONS)),
});

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, value) ? value : ROLES.USER;
}

export function roleForUser(user, isOwnerFn) {
  if (isOwnerFn?.(user)) return ROLES.OWNER;
  return normalizeRole(user?.role);
}

export function hasRole(user, minimumRole, isOwnerFn) {
  const actual = roleForUser(user, isOwnerFn);
  return (ROLE_RANK[actual] || 0) >= (ROLE_RANK[normalizeRole(minimumRole)] || 0);
}

export function hasPermission(user, permission, isOwnerFn) {
  const role = roleForUser(user, isOwnerFn);
  return ROLE_PERMISSIONS[role]?.has(permission) === true;
}

export function requirePermission(permission, isOwnerFn) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'sign_in_required' });
    if (!hasPermission(req.user, permission, isOwnerFn)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

export function requireRole(minimumRole, isOwnerFn) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'sign_in_required' });
    if (!hasRole(req.user, minimumRole, isOwnerFn)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

export function publicRole(user, isOwnerFn) {
  return roleForUser(user, isOwnerFn);
}
