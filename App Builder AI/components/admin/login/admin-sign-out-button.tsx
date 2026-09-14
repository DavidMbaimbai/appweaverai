'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/**
 * Signs the current session out and returns to the dedicated admin sign-in
 * screen, so a non-admin account can hand off to an authorized admin account
 * without leaving the Admin Console context.
 */
export function AdminSignOutButton({ className }: { className?: string }) {
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
        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}>
      {isLoading ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
