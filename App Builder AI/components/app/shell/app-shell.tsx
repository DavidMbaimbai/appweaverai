'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AppWorkspace } from '@/lib/app-types';
import { AppSidebar } from './app-sidebar';
import { CommandPalette } from './command-pallete';
import { FeedbackWidget } from '@/components/app/feedback/feedback-widget';

type BillingSummary = {
  creditBalance: number;
  plan: string;
  daysUntilRenewal: number | null;
} | null;

type AppSheellProps = {
  children: React.ReactNode;
  workspaces: AppWorkspace[];
  activeWorkspaceSlug?: string;
  billing?: BillingSummary;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export function AppShell({
  children,
  workspaces,
  activeWorkspaceSlug,
  billing,
  user,
}: AppSheellProps) {
  const [commandOpen, setCommandOpen] = useState(false);

  const openCommand = useCallback(() => {
    setCommandOpen(true);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app-theme flex min-h-screen bg-app-bg text-app-text">
      {/* AppSidebar */}
      <AppSidebar
        workspaces={workspaces}
        activeWorkspaceSlug={activeWorkspaceSlug}
        user={user}
        billing={billing}
        onOpenSearch={openCommand}
      />

      {/* Main */}
      <div className="app-theme-main flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {/* CommandPalette */}
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
      />

      <FeedbackWidget />
    </div>
  );
}
