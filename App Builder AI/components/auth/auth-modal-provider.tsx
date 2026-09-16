'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  shouldShowAuthModal,
  type AuthSessionStatus,
} from '@/lib/auth/session-status';
import type { AuthMode, OAuthProvider } from '@/lib/types/account';
import { AuthModal } from './auth-modal';
import { useAuthSession } from './session-provider';

type AuthModalContextValue = {
  isOpen: boolean;
  mode: AuthMode;
  initialError: string | null;
  enabledOAuthProviders: OAuthProvider[];
  openAuthModal: (mode?: AuthMode, error?: string | null) => void;
  closeAuthModal: () => void;
  setAuthMode: (mode: AuthMode) => void;
};

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

export function canOpenAuthModal(status: AuthSessionStatus) {
  return status === 'unauthenticated';
}

export function AuthModalProvider({
  children,
  enabledOAuthProviders,
}: {
  children: ReactNode;
  enabledOAuthProviders: OAuthProvider[];
}) {
  const { status } = useAuthSession();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [initialError, setInitialError] = useState<string | null>(null);

  const openAuthModal = useCallback(
    (nextMode: AuthMode = 'login', error: string | null = null) => {
      if (!canOpenAuthModal(status)) {
        setInitialError(null);
        setIsOpen(false);
        return;
      }

      setInitialError(error);
      setMode(nextMode);
      setIsOpen(true);
    },
    [status],
  );

  const closeAuthModal = useCallback(() => {
    setInitialError(null);
    setIsOpen(false);
  }, []);

  const setAuthMode = useCallback((nextMode: AuthMode) => {
    setInitialError(null);
    setMode(nextMode);
  }, []);

  const effectiveIsOpen = shouldShowAuthModal({
    requestedOpen: isOpen,
    status,
  });
  const effectiveInitialError =
    status === 'authenticated' ? null : initialError;

  const value = useMemo(
    () => ({
      isOpen: effectiveIsOpen,
      mode,
      initialError: effectiveInitialError,
      enabledOAuthProviders,
      openAuthModal,
      closeAuthModal,
      setAuthMode,
    }),
    [
      effectiveIsOpen,
      mode,
      effectiveInitialError,
      enabledOAuthProviders,
      openAuthModal,
      closeAuthModal,
      setAuthMode,
    ],
  );

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <AuthModal />
    </AuthModalContext.Provider>
  );
}

export function useAuthModal() {
  const context = useContext(AuthModalContext);

  if (!context) {
    throw new Error('useAuthModal must be used within AuthModalProvider');
  }

  return context;
}
