import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AdminShell } from '@/components/admin/shell/admin-shell';
import { AdminSignOutButton } from '@/components/admin/login/admin-sign-out-button';

/**
 * Guards every protected admin page. The admin area has its own dedicated
 * sign-in page at /admin/login, separate from the customer-facing auth
 * modal — this layout never renders that page itself, it only decides
 * whether to show the admin dashboard, redirect unauthenticated visitors to
 * /admin/login, or show a plain "not authorized" screen for signed-in
 * non-admin accounts.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await requireAdmin();

  if (!result.ok) {
    if (result.reason === 'unauthenticated') {
      redirect('/admin/login');
    }

    return <AccessDenied reason={result.reason} />;
  }

  return <AdminShell admin={result.admin}>{children}</AdminShell>;
}

function AccessDenied({
  reason,
}: {
  reason: 'forbidden' | 'no_database';
}) {
  const message =
    reason === 'no_database'
      ? 'Sign-in is unavailable right now. Please try again later.'
      : 'This account doesn\'t have admin access. Contact an administrator if you think this is a mistake.';

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-6 text-center">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold text-app-text">Access denied</h1>
        <p className="mt-2 text-sm text-app-text-secondary">{message}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {reason === 'forbidden' && (
            <AdminSignOutButton className="rounded-full border border-app-border-subtle px-5 py-2 text-sm font-medium text-app-text hover:bg-app-surface-hover" />
          )}
          <Link
            href="/app"
            className="inline-block rounded-full bg-replit-orange px-5 py-2 text-sm font-medium text-white hover:bg-replit-orange-mid">
            Back to product
          </Link>
        </div>
      </div>
    </div>
  );
}
