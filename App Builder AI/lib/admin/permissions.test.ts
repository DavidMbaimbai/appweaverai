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
      // outreach/observatory reads expose investor and customer-app data, so analytics viewers don't get them.
      const expected =
        permission.endsWith(':read') &&
        permission !== 'outreach:read' &&
        permission !== 'observatory:read' &&
        permission !== 'commandcentre:read' &&
        permission !== 'marketing-reports:read' &&
        permission !== 'contentpipeline:read' &&
        permission !== 'inbox:read' &&
        permission !== 'meetings:read' &&
        permission !== 'backups:read' &&
        permission !== 'codescan:read' &&
        permission !== 'privacy:read' &&
        permission !== 'revenue:read' &&
        permission !== 'integrations:read';
      expect(hasPermission('ANALYTICS_VIEWER', permission)).toBe(expected);
    }
  });

  it('gives meetings to admin roles, private notes only to ADMIN and above', () => {
    expect(hasPermission('SUPPORT_ADMIN', 'meetings:write')).toBe(true);
    expect(hasPermission('SUPPORT_ADMIN', 'meetings:notes')).toBe(false);
    expect(hasPermission('ADMIN', 'meetings:notes')).toBe(true);
    for (const role of ['FINANCE_ADMIN', 'SECURITY_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'meetings:read')).toBe(false);
      expect(hasPermission(role, 'meetings:notes')).toBe(false);
    }
  });

  it('gives the unified inbox to support and admin roles only', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN'] as const) {
      expect(hasPermission(role, 'inbox:read')).toBe(true);
      expect(hasPermission(role, 'inbox:write')).toBe(true);
    }
    for (const role of ['FINANCE_ADMIN', 'SECURITY_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'inbox:read')).toBe(false);
      expect(hasPermission(role, 'inbox:write')).toBe(false);
    }
  });

  it('limits the command centre to ADMIN and SUPER_ADMIN', () => {
    expect(hasPermission('ADMIN', 'commandcentre:write')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'commandcentre:read')).toBe(true);
    for (const role of ['SUPPORT_ADMIN', 'FINANCE_ADMIN', 'SECURITY_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'commandcentre:read')).toBe(false);
      expect(hasPermission(role, 'commandcentre:write')).toBe(false);
    }
  });

  it('limits the content pipeline to ADMIN and SUPER_ADMIN', () => {
    expect(hasPermission('ADMIN', 'contentpipeline:write')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'contentpipeline:read')).toBe(true);
    for (const role of ['SUPPORT_ADMIN', 'FINANCE_ADMIN', 'SECURITY_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'contentpipeline:read')).toBe(false);
      expect(hasPermission(role, 'contentpipeline:write')).toBe(false);
    }
  });

  it('limits growth attribution to ADMIN-level roles for writes and read-only roles for reads', () => {
    expect(hasPermission('ADMIN', 'growth:read')).toBe(true);
    expect(hasPermission('ADMIN', 'growth:write')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'growth:write')).toBe(true);
    expect(hasPermission('ANALYTICS_VIEWER', 'growth:read')).toBe(true);
    expect(hasPermission('ANALYTICS_VIEWER', 'growth:write')).toBe(false);
    for (const role of ['SUPPORT_ADMIN', 'FINANCE_ADMIN', 'SECURITY_ADMIN'] as const) {
      expect(hasPermission(role, 'growth:write')).toBe(false);
    }
  });

  it('limits the observatory to ADMIN and SUPER_ADMIN', () => {
    expect(hasPermission('ADMIN', 'observatory:read')).toBe(true);
    expect(hasPermission('ADMIN', 'observatory:write')).toBe(true);
    expect(hasPermission('SUPPORT_ADMIN', 'observatory:read')).toBe(false);
    expect(hasPermission('SECURITY_ADMIN', 'observatory:write')).toBe(false);
  });

  it('lets only ADMIN-level roles manage video providers', () => {
    expect(hasPermission('ADMIN', 'video:write')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'video:write')).toBe(true);
    expect(hasPermission('ANALYTICS_VIEWER', 'video:read')).toBe(true);
    expect(hasPermission('ANALYTICS_VIEWER', 'video:write')).toBe(false);
    expect(hasPermission('SUPPORT_ADMIN', 'video:write')).toBe(false);
    expect(hasPermission('FINANCE_ADMIN', 'video:write')).toBe(false);
  });

  it('lets finance, support and admin roles adjust credits but not security or analytics roles', () => {
    expect(hasPermission('SUPER_ADMIN', 'credits:write')).toBe(true);
    expect(hasPermission('ADMIN', 'credits:write')).toBe(true);
    expect(hasPermission('FINANCE_ADMIN', 'credits:write')).toBe(true);
    expect(hasPermission('SUPPORT_ADMIN', 'credits:write')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'credits:write')).toBe(false);
    expect(hasPermission('ANALYTICS_VIEWER', 'credits:write')).toBe(false);
  });

  it('limits marketing pricing edits to super admin and admin; reports to finance too', () => {
    expect(hasPermission('SUPER_ADMIN', 'marketing-pricing:write')).toBe(true);
    expect(hasPermission('ADMIN', 'marketing-pricing:write')).toBe(true);
    for (const role of ['FINANCE_ADMIN', 'SUPPORT_ADMIN', 'SECURITY_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'marketing-pricing:write')).toBe(false);
    }
    expect(hasPermission('FINANCE_ADMIN', 'marketing-reports:read')).toBe(true);
    expect(hasPermission('ANALYTICS_VIEWER', 'marketing-reports:read')).toBe(false);
    expect(hasPermission('SUPPORT_ADMIN', 'marketing-reports:read')).toBe(false);
  });

  it('limits backups to read for admins/security and write for super admin only', () => {
    expect(hasPermission('SUPER_ADMIN', 'backups:write')).toBe(true);
    for (const role of ['ADMIN', 'SECURITY_ADMIN'] as const) {
      expect(hasPermission(role, 'backups:read')).toBe(true);
      expect(hasPermission(role, 'backups:write')).toBe(false);
    }
    for (const role of ['FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'backups:read')).toBe(false);
      expect(hasPermission(role, 'backups:write')).toBe(false);
    }
  });

  it('limits code scan to read for ADMIN, read/write for SECURITY_ADMIN, none for others', () => {
    expect(hasPermission('SUPER_ADMIN', 'codescan:write')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'codescan:read')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'codescan:write')).toBe(true);
    expect(hasPermission('ADMIN', 'codescan:read')).toBe(true);
    expect(hasPermission('ADMIN', 'codescan:write')).toBe(false);
    for (const role of ['FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'codescan:read')).toBe(false);
      expect(hasPermission(role, 'codescan:write')).toBe(false);
    }
  });

  it('limits privacy to read/write for ADMIN, read for SECURITY_ADMIN, none for others', () => {
    expect(hasPermission('SUPER_ADMIN', 'privacy:write')).toBe(true);
    expect(hasPermission('ADMIN', 'privacy:read')).toBe(true);
    expect(hasPermission('ADMIN', 'privacy:write')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'privacy:read')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'privacy:write')).toBe(false);
    for (const role of ['FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'privacy:read')).toBe(false);
      expect(hasPermission(role, 'privacy:write')).toBe(false);
    }
  });

  it('limits integrations to read/write for ADMIN, read for SECURITY_ADMIN, none for others', () => {
    expect(hasPermission('SUPER_ADMIN', 'integrations:write')).toBe(true);
    expect(hasPermission('ADMIN', 'integrations:read')).toBe(true);
    expect(hasPermission('ADMIN', 'integrations:write')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'integrations:read')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'integrations:write')).toBe(false);
    for (const role of ['FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'integrations:read')).toBe(false);
      expect(hasPermission(role, 'integrations:write')).toBe(false);
    }
  });

  it('limits marketplace moderation to super admin and admin; security admin is read-only', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      expect(hasPermission(role, 'marketplace:read')).toBe(true);
      expect(hasPermission(role, 'marketplace:write')).toBe(true);
    }
    expect(hasPermission('SECURITY_ADMIN', 'marketplace:read')).toBe(true);
    expect(hasPermission('SECURITY_ADMIN', 'marketplace:write')).toBe(false);
    for (const role of ['FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_VIEWER'] as const) {
      expect(hasPermission(role, 'marketplace:read')).toBe(false);
      expect(hasPermission(role, 'marketplace:write')).toBe(false);
    }
  });

  it('limits revenue:read to super admin, admin and finance admin', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN'] as const) {
      expect(hasPermission(role, 'revenue:read')).toBe(true);
    }
    for (const role of ['SUPPORT_ADMIN', 'ANALYTICS_VIEWER', 'SECURITY_ADMIN'] as const) {
      expect(hasPermission(role, 'revenue:read')).toBe(false);
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
