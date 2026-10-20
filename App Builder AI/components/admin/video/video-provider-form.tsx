'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { updateVideoProviderConfigAction } from '@/lib/admin/actions/video';
import { focusRingStyles, inputStyles } from '@/lib/ui-theme';
import { cn } from '@/lib/utils';

const fieldClass = cn(
  'w-full rounded-xl border px-3.5 py-2.5 text-sm transition-[border-color,box-shadow]',
  inputStyles.app,
  focusRingStyles.app,
);

export function VideoProviderForm({
  providerId,
  initial,
  maxProviderSeconds,
  canWrite,
}: {
  providerId: string;
  initial: {
    enabled: boolean;
    maxSecondsPerJob: number;
    dailyJobLimit: number;
    monthlyBudgetCents: number;
    models: string[];
  };
  maxProviderSeconds: number;
  canWrite: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [maxSeconds, setMaxSeconds] = useState(String(initial.maxSecondsPerJob));
  const [daily, setDaily] = useState(String(initial.dailyJobLimit));
  const [budget, setBudget] = useState((initial.monthlyBudgetCents / 100).toString());
  const [models, setModels] = useState(initial.models.join(', '));
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function save() {
    startTransition(async () => {
      const result = await updateVideoProviderConfigAction(providerId, {
        enabled,
        maxSecondsPerJob: Number(maxSeconds),
        dailyJobLimit: Number(daily),
        monthlyBudgetCents: Math.round(Number(budget) * 100),
        models: models.split(',').map((m) => m.trim()).filter(Boolean),
      });
      if ('error' in result) toast.error(result.error);
      else toast.success('Video provider saved.');
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="flex items-center gap-2 text-sm text-app-text sm:col-span-2">
        <input type="checkbox" checked={enabled} disabled={!canWrite}
          onChange={(e) => setEnabled(e.target.checked)} />
        Enabled (users can generate videos with this provider)
      </label>
      <label className="space-y-1 text-sm text-app-text">
        Max seconds per video (provider limit {maxProviderSeconds})
        <input className={fieldClass} inputMode="numeric" value={maxSeconds} disabled={!canWrite}
          onChange={(e) => setMaxSeconds(e.target.value)} />
      </label>
      <label className="space-y-1 text-sm text-app-text">
        Videos per day (all users)
        <input className={fieldClass} inputMode="numeric" value={daily} disabled={!canWrite}
          onChange={(e) => setDaily(e.target.value)} />
      </label>
      <label className="space-y-1 text-sm text-app-text">
        Monthly budget (USD)
        <input className={fieldClass} inputMode="decimal" value={budget} disabled={!canWrite}
          onChange={(e) => setBudget(e.target.value)} />
      </label>
      <label className="space-y-1 text-sm text-app-text">
        Model ids (comma separated, first is used)
        <input className={fieldClass} value={models} disabled={!canWrite}
          onChange={(e) => setModels(e.target.value)} />
      </label>
      {canWrite ? (
        <div className="sm:col-span-2">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
