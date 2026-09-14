import { describe, expect, it } from 'vitest';

import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_LABELS,
  hasPermission,
  permissionsForRole,
} from '@/lib/admin/permissions';

describe('hasPermission', () => {
  it('returns false when role is null or undefined', () => {
    expect(hasPermission(null, 'dashboard:read')).toBe(false);
    expect(hasPermission(undefined, 'dashboard:read')).toBe(false);
  });

  it('grants SUPER_ADMIN every defined permission', () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(hasPermission('SUPER_ADMIN', permission)).toBe(true);
    }
  });

  it('does not let SUPPORT_ADMIN issue refunds', () => {
    expect(hasPermission('SUPPORT_ADMIN', 'payments:refund')).toBe(false);
  });

  it('does not let SUPPORT_ADMIN manage security settings', () => {
    expect(hasPermission('SUPPORT_ADMIN', 'security:write')).toBe(false);
  });

  it('lets FINANCE_ADMIN read and refund payments', () => {
    expect(hasPermission('FINANCE_ADMIN', 'payments:read')).toBe(true);
    expect(hasPermission('FINANCE_ADMIN', 'payments:refund')).toBe(true);
  });

  it('does not let FINANCE_ADMIN ban users or write user records', () => {
    expect(hasPermission('FINANCE_ADMIN', 'users:ban')).toBe(false);
    expect(hasPermission('FINANCE_ADMIN', 'users:write')).toBe(false);
  });

  it('restricts ANALYTICS_VIEWER to read-only permissions', () => {
    for (const permission of ADMIN_PERMISSIONS) {
      const expected = permission.endsWith(':read');
      expect(hasPermission('ANALYTICS_VIEWER', permission)).toBe(expected);
    }
  });

  it('lets SECURITY_ADMIN ban users and manage security, but not payments', () => {
    expect(hasPermission('SECURITY_ADMIN', 'users:ban')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'security:write')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'payments:read')).toBe(false);
    expect(hasPermission('SECURITY_ADMIN', 'payments:refund')).toBe(false);
  });
});

describe('permissionsForRole', () => {
  it('returns an empty array for a null/undefined role', () => {
    expect(permissionsForRole(null)).toEqual([]);
    expect(permissionsForRole(undefined)).toEqual([]);
  });

  it('returns every permission for SUPER_ADMIN', () => {
    expect(permissionsForRole('SUPER_ADMIN')).toHaveLength(ADMIN_PERMISSIONS.length);
  });

  it('is internally consistent with hasPermission for every role', () => {
    for (const role of Object.keys(ADMIN_ROLE_LABELS) as Array<
      keyof typeof ADMIN_ROLE_LABELS
    >) {
      const granted = new Set(permissionsForRole(role));
      for (const permission of ADMIN_PERMISSIONS) {
        expect(granted.has(permission)).toBe(hasPermission(role, permission));
      }
    }
  });
});
