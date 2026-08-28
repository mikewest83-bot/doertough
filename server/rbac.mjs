// Centralized role-based access control for Mike AI.
// Roles are server-side only. Never trust a role supplied by the browser.
import { dbEnabled, query } from './db.mjs';

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

const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();

export async function ensureRbacSchema() {
  if (!dbEnabled) return false;
  await query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
    UPDATE users SET role = 'owner' WHERE $1 <> '' AND lower(email) = $1;
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audit_log_actor_time_idx ON audit_log (actor_user_id, created_at);
    CREATE INDEX IF NOT EXISTS audit_log_action_time_idx ON audit_log (action, created_at);
  `, [OWNER_EMAIL]);
  return true;
}

export async function audit({ actorUserId, action, targetType = null, targetId = null, metadata = {} }) {
  if (!dbEnabled) return null;
  try {
    const { rows } = await query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [actorUserId || null, String(action), targetType, targetId, JSON.stringify(metadata || {})]
    );
    return rows[0] || null;
  } catch (error) {
    // Authorization should never fail open because audit storage is unavailable.
    console.error('[rbac] audit failed:', error.message || error);
    return null;
  }
}

export async function getRbacOverview() {
  if (!dbEnabled) return { configured: false, users: 0, roles: {}, recentAudit: [] };
  const [usersResult, rolesResult, auditResult] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM users'),
    query('SELECT role, COUNT(*)::int AS count FROM users GROUP BY role ORDER BY role'),
    query(`SELECT action, target_type AS "targetType", target_id AS "targetId", created_at AS "createdAt"
              FROM audit_log ORDER BY created_at DESC LIMIT 25`),
  ]);
  const roles = Object.fromEntries((rolesResult.rows || []).map((row) => [row.role, Number(row.count)]));
  return {
    configured: true,
    users: Number(usersResult.rows[0]?.count || 0),
    roles,
    recentAudit: auditResult.rows || [],
  };
}

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
