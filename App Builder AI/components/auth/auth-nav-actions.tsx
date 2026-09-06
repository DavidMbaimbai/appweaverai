'use client';

import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
import { useAuthModal } from './auth-modal-provider';
import { useMounted } from '@/lib/use-mounted';
import type { AuthNavUser } from '@/lib/types/account';
import { cn } from '@/lib/utils';

const navGhostClass =
  'flex h-8 items-center rounded-md px-2 text-text-secondary transition-colors hover:bg-[#e8e7e3] hover:text-[#212225]';

type AuthNavActionsProps = {
  initialUser?: AuthNavUser | null;
  className?: string;
  createAccountClassName?: string;
};

function AuthNavSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span
        className="h-8 w-16 animate-pulse rounded-md bg-[#e8e7e3]"
        aria-hidden
      />
    </div>
  );
}

function AuthNavSignedIn({
  user,
  className,
}: {
  user: AuthNavUser;
  className?: string;
}) {
  const label = user.name ?? user.email ?? 'Account';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Link href="/app" className={cn(navGhostClass, 'text-sm')}>
        {label}
      </Link>
      <button
        type="button"
        onClick={() => {
          void authClient.signOut({
            fetchOptions: {
              onSuccess: () => {
                window.location.href = '/';
              },
            },
          });
        }}
        className={cn(navGhostClass, 'text-[13px]')}>
        Sign out
      </button>
    </div>
  );
}

function AuthNavSignedOut({
  className,
  createAccountClassName,
}: {
  className?: string;
  createAccountClassName?: string;
}) {
  const { openAuthModal } = useAuthModal();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        onClick={() => openAuthModal('login')}
        className={cn(navGhostClass, 'text-[13px]')}>
        Log in
      </button>
      <button
        type="button"
        onClick={() => openAuthModal('register')}
        className={cn(createAccountClassName)}>
        Create account
      </button>
    </div>
  );
}

export function AuthNavActions({
  initialUser = null,
  className,
  createAccountClassName,
}: AuthNavActionsProps) {
  const mounted = useMounted();
  const { data: session, isPending } = authClient.useSession();
  const user = mounted ? (session?.user ?? initialUser) : initialUser;

  if (mounted && isPending) {
    return <AuthNavSkeleton className={className} />;
  }

  if (user) {
    return <AuthNavSignedIn user={user} className={className} />;
  }

  return (
    <AuthNavSignedOut
      className={className}
      createAccountClassName={createAccountClassName}
    />
  );
}
