'use client';

import { authClient } from '@/lib/auth-client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useAuthModal } from './auth-modal-provider';

function AuthUrlSyncInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { closeAuthModal, openAuthModal } = useAuthModal();

  useEffect(() => {
    if (isPending) return;
    const auth = searchParams.get('auth');
    const authError = searchParams.get('error');
    const callbackUrl =
      searchParams.get('callbackUrl') ?? searchParams.get('callbackurl');
    const safeCallback =
      callbackUrl?.startsWith('/') && !callbackUrl.startsWith('//')
        ? callbackUrl
        : null;

    if (session?.user && safeCallback) {
      closeAuthModal();
      router.replace(safeCallback);
      return;
    }

    if (session?.user && (auth || authError)) {
      closeAuthModal();
      const params = new URLSearchParams(searchParams.toString());
      params.delete('auth');
      params.delete('error');
      params.delete('callbackUrl');
      params.delete('callbackurl');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
      return;
    }

    if (authError) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('auth');
      params.delete('error');
      const query = params.toString();
      const cleanUrl = query ? `${pathname}?${query}` : pathname;

      openAuthModal(
        auth === 'register' ? 'register' : 'login',
        authError === 'invalid_code'
          ? 'That sign-in link expired or was already used. Please try signing in again.'
          : 'Sign-in could not be completed. Please try again.',
      );
      router.replace(cleanUrl);
      return;
    }

    if (auth === 'login' || auth === 'register') {
      if (!session?.user) {
        openAuthModal(auth);
      }
    }
  }, [
    searchParams,
    pathname,
    closeAuthModal,
    openAuthModal,
    session,
    isPending,
    router,
  ]);

  return null;
}

export function AuthUrlSync() {
  return (
    <Suspense fallback={null}>
      <AuthUrlSyncInner />
    </Suspense>
  );
}
