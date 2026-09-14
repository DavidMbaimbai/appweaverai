import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AppWeaverLogo } from '@/components/ui/appweaver-logo';
import { AdminLoginForm } from '@/components/admin/login/admin-login-form';

export const metadata: Metadata = {
  title: 'Admin sign in - AppWeaver AI',
  robots: { index: false, follow: false },
};

/**
 * Dedicated sign-in surface for the Admin Console (separate from the
 * customer-facing auth modal used across the rest of the product). This page
 * lives outside the protected `(console)` route group so it renders even
 * when the visitor has no session at all. Access is still enforced entirely
 * server-side by requireAdmin() in `app/admin/(console)/layout.tsx` — this
 * page never grants access itself, it only offers a way to start a session
 * and reports back whether the resulting account is authorized.
 */
export default async function AdminLoginPage() {
  const result = await requireAdmin();

  if (result.ok) {
    redirect('/admin');
  }

  if (result.reason === 'no_database') {
    return (
      <AdminLoginShell>
        <p className="text-center text-sm text-text-secondary">
          Sign-in is unavailable right now. Please try again later.
        </p>
      </AdminLoginShell>
    );
  }

  return (
    <AdminLoginShell>
      <AdminLoginForm forbidden={result.reason === 'forbidden'} />
    </AdminLoginShell>
  );
}

function AdminLoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border-light bg-surface-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <AppWeaverLogo />
          <div>
            <h1 className="text-lg font-semibold text-text-primary">
              Admin sign in
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Sign in to access the admin dashboard.
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
