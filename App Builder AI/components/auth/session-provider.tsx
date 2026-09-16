'use client';

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import { authClient } from '@/lib/auth-client';
import {
  getAuthSessionStatus,
  type AuthSessionStatus,
} from '@/lib/auth/session-status';

type BetterAuthSessionState = ReturnType<typeof authClient.useSession>;

type AuthSessionContextValue = BetterAuthSessionState & {
  status: AuthSessionStatus;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const sessionState = authClient.useSession();

  const value = useMemo<AuthSessionContextValue>(() => {
    const status = getAuthSessionStatus({
      isPending: sessionState.isPending,
      hasUser: Boolean(sessionState.data?.user),
    });

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
