import Link from 'next/link';

import {
  AdminEmptyState,
  AdminPageHeader,
  StatusPill,
  formatCurrencyCents,
  formatDateTime,
  formatNumber,
} from '@/components/admin/ui/primitives';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { requireAdmin } from '@/lib/auth/require-admin';
import { listProjects } from '@/lib/admin/queries/projects';

const STATUS_TONE = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  ARCHIVED: 'neutral',
} as const;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const auth = await requireAdmin('projects:read');
  if (!auth.ok) return null;

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const { projects, total, pageSize } = await listProjects({
    search: params.q,
    status: params.status,
    page,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <AdminPageHeader
        title="Projects"
        description={`${formatNumber(total)} projects`}
      />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input
          theme="app"
          name="q"
          defaultValue={params.q}
          placeholder="Search by project ID, name, slug, or owner"
          className="w-80"
        />
        <Select theme="app" name="status" defaultValue={params.status ?? ''}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </Select>
        <button
          type="submit"
          className="rounded-full bg-app-surface-active px-4 py-2 text-sm text-app-text hover:bg-app-surface-hover">
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-app-border-subtle">
        {projects.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs text-app-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">AI cost</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  key={project.id}
                  className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="text-app-text hover:underline">
                      {project.name}
                    </Link>
                    <p className="font-mono text-xs text-app-text-muted">
                      {project.id}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
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
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={STATUS_TONE[project.adminStatus]}>
                      {project.adminStatus}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {formatCurrencyCents(project.aiCostCents)}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {formatDateTime(project.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4">
            <AdminEmptyState message="No projects match these filters." />
          </div>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-app-text-secondary">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildPageHref(params, page - 1)}
                className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={buildPageHref(params, page + 1)}
                className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildPageHref(
  params: { q?: string; status?: string },
  page: number,
) {
  const query = new URLSearchParams();

  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  query.set('page', String(page));

  return `/admin/projects?${query.toString()}`;
}
