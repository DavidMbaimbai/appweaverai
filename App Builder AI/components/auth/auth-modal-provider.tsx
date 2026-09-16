'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { AuthMode } from '@/lib/types/account';
import { AuthModal } from './auth-modal';
import { useAuthSession } from './session-provider';

type AuthModalContextValue = {
  isOpen: boolean;
  mode: AuthMode;
  initialError: string | null;
  openAuthModal: (mode?: AuthMode, error?: string | null) => void;
  closeAuthModal: () => void;
  setAuthMode: (mode: AuthMode) => void;
};

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const { status } = useAuthSession();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [initialError, setInitialError] = useState<string | null>(null);

  const openAuthModal = useCallback(
    (nextMode: AuthMode = 'login', error: string | null = null) => {
      if (status !== 'unauthenticated') {
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

  const effectiveIsOpen = status === 'unauthenticated' && isOpen;
  const effectiveInitialError =
    status === 'authenticated' ? null : initialError;

  const value = useMemo(
    () => ({
      isOpen: effectiveIsOpen,
      mode,
      initialError: effectiveInitialError,
      openAuthModal,
      closeAuthModal,
      setAuthMode,
    }),
    [
      effectiveIsOpen,
      mode,
      effectiveInitialError,
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
