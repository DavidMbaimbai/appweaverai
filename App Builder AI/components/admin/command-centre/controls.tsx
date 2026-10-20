'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  decideAgentActivityAction,
  setKillSwitchAction,
  setPlatformAgentStateAction,
} from '@/lib/admin/actions/command-centre';

function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const run = (fn: () => Promise<{ success: true } | { error: string }>, ok: string) =>
    start(async () => {
      const result = await fn();
      if ('error' in result) toast.error(result.error);
      else toast.success(ok);
    });
  return { pending, run };
}

export function KillSwitchControl({ scope, paused, canWrite }: { scope: 'GLOBAL' | 'PLATFORM'; paused: boolean; canWrite: boolean }) {
  const { pending, run } = useRun();
  if (!canWrite) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant={paused ? 'primary' : 'outline'}
      disabled={pending}
      onClick={() =>
        run(() => setKillSwitchAction(scope, !paused, paused ? undefined : 'Paused from the Command Centre'), paused ? 'Resumed.' : 'Paused.')
      }>
      {paused ? 'Resume' : 'Pause all'}
    </Button>
  );
}

export function PlatformAgentControl({ agent, paused, enabled, canWrite }: { agent: string; paused: boolean; enabled: boolean; canWrite: boolean }) {
  const { pending, run } = useRun();
  if (!canWrite) return null;
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending}
        onClick={() => run(() => setPlatformAgentStateAction(agent, paused ? 'resume' : 'pause'), paused ? 'Resumed.' : 'Paused.')}>
        {paused ? 'Resume' : 'Pause'}
      </Button>
      {enabled ? (
        <Button type="button" size="sm" variant="ghost" disabled={pending}
          onClick={() => run(() => setPlatformAgentStateAction(agent, 'disable'), 'Disabled.')}>
          Disable
        </Button>
      ) : null}
    </div>
  );
}

export function ActivityActions({ id, status, canWrite }: { id: string; status: string; canWrite: boolean }) {
  const { pending, run } = useRun();
  if (!canWrite) return null;
  const act = (decision: 'approve' | 'reject' | 'retry' | 'pause', ok: string) =>
    run(() => decideAgentActivityAction(id, decision), ok);
  const waiting = status === 'AWAITING_APPROVAL' || status === 'PLANNED';
  return (
    <div className="flex flex-wrap gap-2">
      {waiting ? (
        <>
          <Button type="button" size="sm" disabled={pending} onClick={() => act('approve', 'Approved.')}>Approve</Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act('reject', 'Rejected.')}>Reject</Button>
        </>
      ) : null}
      {waiting || status === 'RUNNING' ? (
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act('pause', 'Paused.')}>Pause</Button>
      ) : null}
      {status === 'FAILED' || status === 'BLOCKED' ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act('retry', 'Retried.')}>Retry</Button>
      ) : null}
    </div>
  );
}
