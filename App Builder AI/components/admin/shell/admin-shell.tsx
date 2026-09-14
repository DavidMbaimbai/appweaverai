import Link from 'next/link';
import { AppWeaverLogo } from '@/components/ui/appweaver-logo';
import { cn } from '@/lib/utils';
import type { AdminPermission } from '@/lib/admin/permissions';
import { hasPermission } from '@/lib/admin/permissions';
import type { AdminSessionUser } from '@/lib/auth/require-admin';
import { ADMIN_ROLE_LABELS } from '@/lib/admin/permissions';
import { AdminNavLinks } from './admin-nav-links';

export type AdminNavItem = {
  label: string;
  href: string;
  permission: AdminPermission;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { label: 'Dashboard', href: '/admin', permission: 'dashboard:read' },
  { label: 'Users', href: '/admin/users', permission: 'users:read' },
  { label: 'Projects', href: '/admin/projects', permission: 'projects:read' },
  {
    label: 'Subscriptions',
    href: '/admin/subscriptions',
    permission: 'subscriptions:read',
  },
  { label: 'Payments', href: '/admin/payments', permission: 'payments:read' },
  { label: 'AI Usage', href: '/admin/ai-usage', permission: 'ai_usage:read' },
  { label: 'Analytics', href: '/admin/analytics', permission: 'analytics:read' },
  {
    label: 'System Health',
    href: '/admin/system-health',
    permission: 'system_health:read',
  },
  { label: 'Security', href: '/admin/security', permission: 'security:read' },
  { label: 'Audit Logs', href: '/admin/audit-logs', permission: 'audit:read' },
  { label: 'Settings', href: '/admin/settings', permission: 'settings:read' },
];

export function AdminShell({
  admin,
  children,
}: {
  admin: AdminSessionUser;
  children: React.ReactNode;
}) {
  const visibleItems = ADMIN_NAV_ITEMS.filter((item) =>
    hasPermission(admin.adminRole, item.permission),
  );

  return (
    <div className="flex min-h-screen bg-app-bg text-app-text">
      <aside className="flex w-64 shrink-0 flex-col border-r border-app-border-subtle bg-app-sidebar-bg">
        <div className="flex items-center gap-2 px-4 py-4">
          <AppWeaverLogo size="compact" className="text-app-text" />
          <span className="rounded-md bg-app-surface-active px-2 py-0.5 text-xs font-medium text-app-text-muted">
            Admin
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 px-2">
          <AdminNavLinks items={visibleItems} />
        </nav>

        <div className="border-t border-app-border-subtle px-4 py-3">
          <p className="truncate text-sm text-app-text">
            {admin.name ?? admin.email ?? 'Admin'}
          </p>
          <p className="truncate text-xs text-app-text-muted">
            {ADMIN_ROLE_LABELS[admin.adminRole]}
          </p>
          <Link
            href="/app"
            className={cn(
              'mt-2 inline-block text-xs text-app-accent-blue hover:underline',
            )}>
            Back to product →
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
