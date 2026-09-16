'use client';

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import { authClient } from '@/lib/auth-client';

type BetterAuthSessionState = ReturnType<typeof authClient.useSession>;
type AuthSessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthSessionContextValue = BetterAuthSessionState & {
  status: AuthSessionStatus;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const sessionState = authClient.useSession();

  const value = useMemo<AuthSessionContextValue>(() => {
    const status: AuthSessionStatus = sessionState.isPending
      ? 'loading'
      : sessionState.data?.user
        ? 'authenticated'
        : 'unauthenticated';

    return {
      ...sessionState,
      status,
    };
  }, [sessionState]);

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);

  if (!context) {
    throw new Error('useAuthSession must be used within AuthSessionProvider');
  }

  return context;
}
