import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProjectActionsPanel } from '@/components/admin/projects/project-actions-panel';
import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatCurrencyCents,
  formatDateTime,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { getProjectDetail } from '@/lib/admin/queries/projects';
import { requireAdmin } from '@/lib/auth/require-admin';

const PROJECT_STATUS_TONE = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  ARCHIVED: 'neutral',
} as const;

const DEPLOYMENT_STATUS_TONE = {
  PENDING: 'neutral',
  PROVISIONING: 'info',
  BUILDING: 'info',
  BUNDLING: 'info',
  PROMOTING: 'info',
  LIVE: 'success',
  FAILED: 'danger',
  SUPERSEDED: 'neutral',
} as const;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deployments?: string }>;
}) {
  const auth = await requireAdmin('projects:read');
  if (!auth.ok) return null;

  const { id } = await params;
  const { deployments } = await searchParams;
  const deploymentFilter = deployments === 'failed' ? 'failed' : 'all';

  const detail = await getProjectDetail(id, { deployments: deploymentFilter });
  if (!detail) notFound();

  const { project, aiUsage, currentDeployment } = detail;
  const totalTokens =
    (aiUsage._sum.inputTokens ?? 0) + (aiUsage._sum.outputTokens ?? 0);

  return (
    <div>
      <AdminPageHeader
        title={project.name}
        description={project.description ?? project.slug}
        actions={
          <StatusPill tone={PROJECT_STATUS_TONE[project.adminStatus]}>
            {project.adminStatus}
          </StatusPill>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Project">
            <Field label="Project ID" value={project.id} mono />
            <Field label="Slug" value={project.slug} />
            <Field label="Workspace" value={project.workspace.name} />
            <Field label="Workspace type" value={project.workspace.type} />
            <Field label="Created" value={formatDateTime(project.createdAt)} />
            <Field label="Updated" value={formatDateTime(project.updatedAt)} />
            <Field
              label="Artifacts"
              value={formatNumber(project._count.artifacts)}
            />
            <Field label="Files" value={formatNumber(project._count.files)} />
            <Field
              label="Deployment records"
              value={formatNumber(project._count.deployments)}
            />
            <Field
              label="Review flags"
              value={formatNumber(project._count.flags)}
            />

            {project.description ? (
              <div className="pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-app-text-muted">
                  Description
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-app-text-secondary">
                  {project.description}
                </p>
              </div>
            ) : null}
          </Section>

          <Section title="Owner">
            <div className="flex items-center justify-between gap-4 text-sm">
              <div>
                <Link
                  href={`/admin/users/${project.createdBy.id}`}
                  className="text-app-text hover:underline">
                  {project.createdBy.name ||
                    project.createdBy.username ||
                    project.createdBy.email ||
                    'Unknown user'}
                </Link>
                <p className="text-xs text-app-text-muted">
                  {project.createdBy.email ?? 'No email'}
                </p>
              </div>
              <StatusPill
                tone={
                  project.createdBy.accountStatus === 'ACTIVE'
                    ? 'success'
                    : project.createdBy.accountStatus === 'SUSPENDED'
                      ? 'warning'
                      : project.createdBy.accountStatus === 'BANNED'
                        ? 'danger'
                        : 'neutral'
                }>
                {project.createdBy.accountStatus}
              </StatusPill>
            </div>
          </Section>

          <Section title="Lifecycle and moderation">
            <Field label="Admin status" value={project.adminStatus} />
            <Field
              label="Suspended at"
              value={project.suspendedAt ? formatDateTime(project.suspendedAt) : '—'}
            />
            <Field
              label="Suspended by"
              value={project.suspendedById ?? '—'}
              mono={Boolean(project.suspendedById)}
            />
            <Field
              label="Suspended reason"
              value={project.suspendedReason ?? '—'}
            />
            <Field
              label="Archived at"
              value={project.archivedAt ? formatDateTime(project.archivedAt) : '—'}
            />
            <Field
              label="Soft deleted"
              value={project.deletedAt ? formatDateTime(project.deletedAt) : 'No'}
            />
          </Section>

          <Section title="AI usage">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <KpiCard
                label="Total requests"
                value={formatNumber(aiUsage._count._all)}
              />
              <KpiCard
                label="Total tokens"
                value={formatNumber(totalTokens)}
              />
              <KpiCard
                label="Total cost"
                value={formatCurrencyCents(aiUsage._sum.estimatedCostCents ?? 0)}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-app-text-secondary">
              <span>All AI usage tied to this project ID.</span>
              <Link href="/admin/ai-usage" className="text-app-accent-blue hover:underline">
                View AI usage console →
              </Link>
            </div>
          </Section>

          <Section title="Deployment history">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm text-app-text-secondary">
                Showing up to 50 most recent deployments.
              </div>
              <div className="flex gap-1 rounded-full border border-app-border-subtle p-1">
                <Link
                  href={`/admin/projects/${project.id}`}
                  className={
                    deploymentFilter === 'all'
                      ? 'rounded-full bg-app-surface-active px-3 py-1 text-xs font-medium text-app-text'
                      : 'rounded-full px-3 py-1 text-xs font-medium text-app-text-secondary hover:text-app-text'
                  }>
                  All
                </Link>
                <Link
                  href={`/admin/projects/${project.id}?deployments=failed`}
                  className={
                    deploymentFilter === 'failed'
                      ? 'rounded-full bg-app-surface-active px-3 py-1 text-xs font-medium text-app-text'
                      : 'rounded-full px-3 py-1 text-xs font-medium text-app-text-secondary hover:text-app-text'
                  }>
                  Failed only
                </Link>
              </div>
            </div>

            {detail.deployments.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-app-border-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-app-surface text-left text-xs text-app-text-muted">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Version</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Type</th>
                      <th className="px-4 py-2.5 font-medium">Domain</th>
                      <th className="px-4 py-2.5 font-medium">Published</th>
                      <th className="px-4 py-2.5 font-medium">Current</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.deployments.map((deployment) => (
                      <tr
                        key={deployment.id}
                        className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                        <td className="px-4 py-2.5 text-app-text-secondary">
                          v{deployment.version}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusPill tone={DEPLOYMENT_STATUS_TONE[deployment.status]}>
                            {deployment.status}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-2.5 text-app-text-secondary">
                          {deployment.deploymentType}
                          <p className="text-xs text-app-text-muted">
                            {deployment.visibility}
                          </p>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-mono text-xs text-app-text">
                            {deployment.domain}
                          </p>
                          {deployment.customDomain ? (
                            <p className="text-xs text-app-text-muted">
                              Custom: {deployment.customDomain}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-app-text-secondary">
                          {deployment.publishedAt
                            ? formatDateTime(deployment.publishedAt)
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {deployment.isCurrent ? (
                            <StatusPill tone="info">Current</StatusPill>
                          ) : (
                            <span className="text-app-text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <AdminEmptyState
                message={
                  deploymentFilter === 'failed'
                    ? 'No failed deployments found for this project.'
                    : 'No deployments found for this project.'
                }
              />
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <ProjectActionsPanel
            projectId={project.id}
            adminStatus={project.adminStatus}
            canWrite={hasPermission(auth.admin.adminRole, 'projects:write')}
          />

          <Section title="Current deployment">
            {currentDeployment ? (
              <>
                <Field label="Status" value={currentDeployment.status} />
                <Field
                  label="Type"
                  value={currentDeployment.deploymentType}
                />
                <Field label="Visibility" value={currentDeployment.visibility} />
                <Field label="Domain" value={currentDeployment.domain} mono />
                <Field
                  label="Custom domain"
                  value={currentDeployment.customDomain ?? '—'}
                />
                <Field
                  label="Published"
                  value={
                    currentDeployment.publishedAt
                      ? formatDateTime(currentDeployment.publishedAt)
                      : '—'
                  }
                />
              </>
            ) : (
              <p className="text-sm text-app-text-muted">
                No current deployment recorded.
              </p>
            )}
          </Section>
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
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-app-text-muted">{label}</span>
      <span
        className={
          mono
            ? 'max-w-[60%] break-all font-mono text-xs text-app-text'
            : 'max-w-[60%] break-words text-right text-app-text'
        }>
        {value}
      </span>
    </div>
  );
}
