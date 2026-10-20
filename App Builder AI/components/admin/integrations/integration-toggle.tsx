'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminSetIntegrationDisabledAction } from '@/lib/admin/actions/integrations';

export function IntegrationToggle({ integrationId, disabled }: { integrationId: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  function toggle() {
    let reason = '';
    if (!disabled) {
      reason = window.prompt('Reason for disabling (shown to customers):') ?? '';
      if (!reason.trim()) return;
    }
    start(async () => {
      const res = await adminSetIntegrationDisabledAction(integrationId, !disabled, reason);
      setMessage('error' in res ? res.error : res.message);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className="rounded-full border border-app-border-subtle px-2.5 py-1 text-xs text-app-text hover:bg-app-surface-hover disabled:opacity-50"
      >
        {pending ? 'Saving…' : disabled ? 'Enable' : 'Disable'}
      </button>
      {message ? <span className="text-xs text-app-text-secondary">{message}</span> : null}
    </div>
  );
}
