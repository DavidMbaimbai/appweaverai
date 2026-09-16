'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useAuthModal } from './auth-modal-provider';
import { useAuthSession } from './session-provider';

const AUTH_QUERY_KEYS = [
  'auth',
  'error',
  'callbackUrl',
  'callbackurl',
  'callbackURL',
  'code',
  'state',
  'token',
] as const;

const CONSUMED_AUTH_ERROR_PREFIX = 'appweaver:consumed-auth-error:';

function stripAuthQuery(searchParams: URLSearchParams, pathname: string) {
  const params = new URLSearchParams(searchParams.toString());

  for (const key of AUTH_QUERY_KEYS) {
    params.delete(key);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function replaceAuthUrl(router: ReturnType<typeof useRouter>, url: string) {
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', url);
  }

  router.replace(url);
}

function AuthUrlSyncInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useAuthSession();
  const { closeAuthModal, openAuthModal } = useAuthModal();

  useEffect(() => {
    if (status === 'loading') return;
    const auth = searchParams.get('auth');
    const authError = searchParams.get('error');
    const callbackUrl =
      searchParams.get('callbackUrl') ??
      searchParams.get('callbackurl') ??
      searchParams.get('callbackURL');
    const safeCallback =
      callbackUrl?.startsWith('/') && !callbackUrl.startsWith('//')
        ? callbackUrl
        : null;
    const cleanUrl = stripAuthQuery(searchParams, pathname);

    if (session?.user && safeCallback) {
      closeAuthModal();
      replaceAuthUrl(router, safeCallback);
      return;
    }

    if (session?.user && (auth || authError)) {
      closeAuthModal();
      replaceAuthUrl(router, cleanUrl);
      return;
    }

    if (authError) {
      const errorKey = `${CONSUMED_AUTH_ERROR_PREFIX}${pathname}?${searchParams.toString()}`;
      let hasConsumedError = false;

      if (typeof window !== 'undefined') {
        try {
          hasConsumedError = window.sessionStorage.getItem(errorKey) === '1';
        } catch {
          hasConsumedError = false;
        }
      }

      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(errorKey, '1');
        } catch {
          // Ignore storage failures; URL cleanup still prevents replay.
        }
      }
      replaceAuthUrl(router, cleanUrl);

      if (hasConsumedError) {
        closeAuthModal();
        return;
      }
      openAuthModal(
        auth === 'register' ? 'register' : 'login',
        authError === 'invalid_code'
          ? 'That sign-in link expired or was already used. Please try signing in again.'
          : 'Sign-in could not be completed. Please try again.',
      );
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
    status,
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
