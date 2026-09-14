'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { AdminSignOutButton } from './admin-sign-out-button';

const ADMIN_CALLBACK_URL = '/admin';

type AdminLoginFormProps = {
  /** Set when the visitor already has a session but it isn't an authorized admin account. */
  forbidden?: boolean;
};

export function AdminLoginForm({ forbidden }: AdminLoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    void authClient.signIn.email({
      email,
      password,
      callbackURL: ADMIN_CALLBACK_URL,
      fetchOptions: {
        onSuccess: () => {
          router.push(ADMIN_CALLBACK_URL);
          router.refresh();
        },
        onError: (ctx) => {
          setIsLoading(false);
          setError(ctx.error.message ?? 'Invalid email or password.');
        },
      },
    });
  }

  if (forbidden) {
    return (
      <div className="space-y-5 text-center">
        <p className="rounded-xl bg-appweaver-orange/10 px-4 py-3 text-sm text-appweaver-orange">
          This account doesn&apos;t have admin access. Sign out and try
          another account.
        </p>
        <AdminSignOutButton className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-appweaver-orange text-sm font-medium text-white hover:bg-[#e03600]" />
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <label
          htmlFor="admin-email"
          className="block text-sm font-medium text-text-secondary">
          Email
        </label>
        <input
          id="admin-email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 text-sm text-text-primary placeholder:text-text-muted transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="admin-password"
          className="block text-sm font-medium text-text-secondary">
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Enter your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 text-sm text-text-primary placeholder:text-text-muted transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20"
        />
      </div>

      {error && (
        <p className="rounded-xl bg-appweaver-orange/10 px-3 py-2 text-sm text-appweaver-orange">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="h-11 w-full rounded-xl bg-appweaver-orange text-sm font-medium text-white transition-colors hover:bg-[#e03600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appweaver-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
        {isLoading ? 'Signing in…' : 'Log in'}
      </button>
    </form>
  );
}
