'use client';

import { useEffect, useState } from 'react';

import { avatarFallbackStyles } from '@/lib/ui-theme';
import { cn } from '@/lib/utils';

type Collaborator = {
  userId: string;
  name: string;
  image: string | null;
  lastSeen: number;
};

const HEARTBEAT_INTERVAL_MS = 8_000;
const MAX_VISIBLE = 4;

/**
 * Shows a live avatar stack of everyone else with this project's editor
 * open right now (see lib/presence.ts). Sends a heartbeat on an interval so
 * the server can track "currently active" collaborators without any
 * websocket/DB infrastructure — a pragmatic MVP for real-time presence.
 */
export function PresenceAvatars({ projectId }: { projectId: string }) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function heartbeat() {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/presence`,
          { method: 'POST' },
        );
        if (!response.ok || cancelled) return;

        const data = (await response.json()) as {
          collaborators: Collaborator[];
        };
        setCollaborators(data.collaborators);
      } catch {
        // Presence is best-effort — ignore transient network errors.
      }
    }

    void heartbeat();
    const interval = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

    function handleUnload() {
      navigator.sendBeacon?.(`/api/projects/${projectId}/presence`);
    }
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
      void fetch(`/api/projects/${projectId}/presence`, {
        method: 'DELETE',
      }).catch(() => {});
    };
  }, [projectId]);

  if (collaborators.length <= 1) return null;

  const visible = collaborators.slice(0, MAX_VISIBLE);
  const overflow = collaborators.length - visible.length;

  return (
    <div
      className="hidden items-center tablet-up:flex"
      title={`${collaborators.length} people viewing this project`}>
      <div className="flex -space-x-2">
        {visible.map((collaborator) => (
          <div
            key={collaborator.userId}
            title={collaborator.name}
            className={cn(
              'flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-app-sidebar-bg text-[10px] font-semibold uppercase',
              avatarFallbackStyles.app,
            )}>
            {collaborator.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={collaborator.image}
                alt={collaborator.name}
                className="h-full w-full object-cover"
              />
            ) : (
              collaborator.name.slice(0, 2)
            )}
          </div>
        ))}
        {overflow > 0 ? (
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full border-2 border-app-sidebar-bg text-[10px] font-semibold',
              avatarFallbackStyles.app,
            )}>
            +{overflow}
          </div>
        ) : null}
      </div>
    </div>
  );
}
