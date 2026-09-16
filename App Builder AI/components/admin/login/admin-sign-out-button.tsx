'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { PencilIcon } from '@/components/app/shell/user-area-icons';
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
  /** Shows a small red pencil icon before the label. */
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
        <PencilIcon className="h-3.5 w-3.5 shrink-0 text-red-500" />
      ) : null}
      {isLoading ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

