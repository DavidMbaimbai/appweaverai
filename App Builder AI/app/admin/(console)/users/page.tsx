import Link from 'next/link';
import { AdminPageHeader, StatusPill } from '@/components/admin/ui/primitives';
import { formatDateTime } from '@/components/admin/ui/primitives';
import { listUsers } from '@/lib/admin/queries/users';
import { requireAdmin } from '@/lib/auth/require-admin';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const STATUS_TONE = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DISABLED: 'neutral',
  BANNED: 'danger',
} as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; plan?: string; page?: string }>;
}) {
  await requireAdmin('users:read');
  const params = await searchParams;
  const page = Number(params.page) || 1;

  const { users, total, pageSize } = await listUsers({
    search: params.q,
    status: params.status,
    plan: params.plan,
    page,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <AdminPageHeader
        title="Users"
        description={`${total} accounts`}
      />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input
          theme="app"
          name="q"
          defaultValue={params.q}
          placeholder="Search by ID, name, email, or username"
          className="w-72"
        />
        <Select theme="app" name="status" defaultValue={params.status ?? ''}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DISABLED">Disabled</option>
          <option value="BANNED">Banned</option>
        </Select>
        <Select theme="app" name="plan" defaultValue={params.plan ?? ''}>
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </Select>
        <button
          type="submit"
          className="rounded-full bg-app-surface-active px-4 py-2 text-sm text-app-text hover:bg-app-surface-hover">
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-app-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-app-surface text-left text-xs text-app-text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Plan</th>
              <th className="px-4 py-2.5 font-medium">Projects</th>
              <th className="px-4 py-2.5 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-t border-app-border-subtle hover:bg-app-surface-hover">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="text-app-text hover:underline">
                    {user.name || user.username || 'Unnamed'}
                  </Link>
                  <p className="text-xs text-app-text-muted">{user.email}</p>
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill tone={STATUS_TONE[user.accountStatus]}>
                    {user.accountStatus}
                  </StatusPill>
                  {user.adminRole ? (
                    <StatusPill tone="info" className="ml-1.5">
                      {user.adminRole}
                    </StatusPill>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {user.subscriptionPlan}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {user._count.createdProjects}
                </td>
                <td className="px-4 py-2.5 text-app-text-secondary">
                  {formatDateTime(user.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 ? (
          <p className="p-8 text-center text-sm text-app-text-muted">
            No users match these filters.
          </p>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-app-text-secondary">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`/admin/users?page=${page - 1}`}
                className="rounded-full border border-app-border-subtle px-3 py-1 hover:bg-app-surface-hover">
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={`/admin/users?page=${page + 1}`}
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
