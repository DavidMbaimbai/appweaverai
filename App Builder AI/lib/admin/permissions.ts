import type { AdminRole } from '@/lib/generated/prisma/client';

/**
 * Admin Console permission matrix (ADM-002).
 *
 * Every privileged server action/route must check `hasPermission` itself —
 * hiding UI controls is never sufficient authorization on its own.
 */
export const ADMIN_PERMISSIONS = [
  'dashboard:read',
  'users:read',
  'users:write',
  'users:roles',
  'users:ban',
  'projects:read',
  'projects:write',
  'payments:read',
  'payments:refund',
  'subscriptions:read',
  'subscriptions:write',
  'ai_usage:read',
  'ai_usage:write',
  'analytics:read',
  'system_health:read',
  'audit:read',
  'security:read',
  'security:write',
  'settings:read',
  'settings:write',
  'exports:read',
  'feedback:read',
  'feedback:write',
  'sso:read',
  'sso:write',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ALL_PERMISSIONS = new Set<AdminPermission>(ADMIN_PERMISSIONS);

const READ_ONLY_PERMISSIONS = new Set<AdminPermission>(
  ADMIN_PERMISSIONS.filter((permission) => permission.endsWith(':read')),
);

const ROLE_PERMISSIONS: Record<AdminRole, Set<AdminPermission>> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ADMIN: new Set<AdminPermission>([
    'dashboard:read',
    'users:read',
    'users:write',
    'users:ban',
    'projects:read',
    'projects:write',
    'payments:read',
    'subscriptions:read',
    'subscriptions:write',
    'ai_usage:read',
    'ai_usage:write',
    'analytics:read',
    'system_health:read',
    'audit:read',
    'security:read',
    'settings:read',
    'exports:read',
    'feedback:read',
    'feedback:write',
    'sso:read',
    'sso:write',
  ]),
  FINANCE_ADMIN: new Set<AdminPermission>([
    'dashboard:read',
    'users:read',
    'payments:read',
    'payments:refund',
    'subscriptions:read',
    'subscriptions:write',
    'ai_usage:read',
    'analytics:read',
    'audit:read',
    'exports:read',
  ]),
  SUPPORT_ADMIN: new Set<AdminPermission>([
    'dashboard:read',
    'users:read',
    'users:write',
    'projects:read',
    'projects:write',
    'subscriptions:read',
    'ai_usage:read',
    'feedback:read',
    'feedback:write',
  ]),
  ANALYTICS_VIEWER: READ_ONLY_PERMISSIONS,
  SECURITY_ADMIN: new Set<AdminPermission>([
    'dashboard:read',
    'users:read',
    'users:ban',
    'projects:read',
    'projects:write',
    'audit:read',
    'security:read',
    'security:write',
    'system_health:read',
    'sso:read',
    'sso:write',
  ]),
};

export function hasPermission(
  role: AdminRole | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsForRole(role: AdminRole | null | undefined) {
  if (!role) return [] as AdminPermission[];
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  FINANCE_ADMIN: 'Finance Admin',
  SUPPORT_ADMIN: 'Support Admin',
  ANALYTICS_VIEWER: 'Analytics Viewer',
  SECURITY_ADMIN: 'Security Admin',
};
