import { notFound } from 'next/navigation';
import Link from 'next/link';

import {
  AdminPageHeader,
  StatusPill,
  formatCurrencyCents,
  formatDateTime,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { getUserDetail } from '@/lib/admin/queries/users';
import { requireAdmin } from '@/lib/auth/require-admin';
import { hasPermission } from '@/lib/admin/permissions';
import { UserActionsPanel } from '@/components/admin/users/user-actions-panel';

const STATUS_TONE = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DISABLED: 'neutral',
  BANNED: 'danger',
} as const;

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAdmin('users:read');
  if (!auth.ok) return null;

  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) notFound();

  const { user, aiUsage, recentProjects } = detail;

  return (
    <div>
      <AdminPageHeader
        title={user.name || user.username || user.email || 'User'}
        description={user.email ?? undefined}
        actions={
          <StatusPill tone={STATUS_TONE[user.accountStatus]}>
            {user.accountStatus}
          </StatusPill>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Section title="Account">
            <Field label="User ID" value={user.id} mono />
            <Field label="Username" value={user.username ?? '—'} />
            <Field label="Plan" value={user.subscriptionPlan} />
            <Field
              label="Subscription status"
              value={user.subscriptionStatus ?? '—'}
            />
            <Field label="Credit balance" value={formatNumber(user.creditBalance)} />
            <Field label="Joined" value={formatDateTime(user.createdAt)} />
            <Field
              label="Projects"
              value={String(user._count.createdProjects)}
            />
            {user.statusReason ? (
              <Field label="Status reason" value={user.statusReason} />
            ) : null}
          </Section>

          <Section title="AI usage">
            <Field
              label="Total requests"
              value={formatNumber(aiUsage._count._all)}
            />
            <Field
              label="Total tokens"
              value={formatNumber(
                (aiUsage._sum.inputTokens ?? 0) +
                  (aiUsage._sum.outputTokens ?? 0),
              )}
            />
            <Field
              label="Total cost"
              value={formatCurrencyCents(aiUsage._sum.estimatedCostCents ?? 0)}
            />
          </Section>

          <Section title="Recent projects">
            {recentProjects.length === 0 ? (
              <p className="text-sm text-app-text-muted">No projects yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {recentProjects.map((project) => (
                  <li key={project.id} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="text-app-text hover:underline">
                      {project.name}
                    </Link>
                    <span className="text-xs text-app-text-muted">
                      {formatDateTime(project.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {user.creditAdjustments.length > 0 ? (
            <Section title="Credit adjustment history">
              <ul className="space-y-1.5 text-sm">
                {user.creditAdjustments.map((adj) => (
                  <li key={adj.id} className="flex items-center justify-between">
                    <span className="text-app-text-secondary">
                      {adj.amount > 0 ? '+' : ''}
                      {adj.amount} — {adj.reason}
                    </span>
                    <span className="text-xs text-app-text-muted">
                      {formatDateTime(adj.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div>
          <UserActionsPanel
            userId={user.id}
            accountStatus={user.accountStatus}
            adminRole={user.adminRole}
            canWrite={hasPermission(auth.admin.adminRole, 'users:write')}
            canBan={hasPermission(auth.admin.adminRole, 'users:ban')}
            canSetRole={hasPermission(auth.admin.adminRole, 'users:roles')}
          />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-app-text">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-app-text-muted">{label}</span>
      <span className={mono ? 'font-mono text-xs text-app-text' : 'text-app-text'}>
        {value}
      </span>
    </div>
  );
}
