'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/**
 * Signs the current session out and returns to the dedicated admin sign-in
 * screen, so a non-admin account can hand off to an authorized admin account
 * without leaving the Admin Console context.
 */
export function AdminSignOutButton({
  className,
  icon = false,
}: {
  className?: string;
  /** Shows a small red trash/sign-out icon before the label. */
  icon?: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={isLoading}
      onClick={() => {
        setIsLoading(true);
        void authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              window.location.href = '/admin/login';
            },
            onError: () => {
              setIsLoading(false);
            },
          },
        });
      }}
      className={cn(
        icon && 'inline-flex items-center gap-1.5',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}>
      {icon ? (
        <SignOutIcon className="h-3.5 w-3.5 shrink-0 text-red-500" />
      ) : null}
      {isLoading ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M10 7V6a2 2 0 0 1 2-2h7v16h-7a2 2 0 0 1-2-2v-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M14 12H4m0 0 3-3M4 12l3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
