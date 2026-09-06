'use client';

import { ToastProvider } from './ui/toast';

export function RootProviders({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
