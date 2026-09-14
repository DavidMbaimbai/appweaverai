'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  changeSubscriptionPlanAction,
  extendSubscriptionTrialAction,
} from '@/lib/admin/actions/subscriptions';

function toDateTimeLocalValue(value: string | null) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (segment: number) => `${segment}`.padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SubscriptionActionsPanel({
  userId,
  currentPlan,
  stripeConfigured,
  hasStripeSubscription,
  trialEndIso,
}: {
  userId: string;
  currentPlan: string;
  stripeConfigured: boolean;
  hasStripeSubscription: boolean;
  trialEndIso: string | null;
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [plan, setPlan] = useState(currentPlan);
  const [planReason, setPlanReason] = useState('');
  const [trialReason, setTrialReason] = useState('');
  const [trialEnd, setTrialEnd] = useState(toDateTimeLocalValue(trialEndIso));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const trialHelpText = useMemo(() => {
    if (!stripeConfigured) {
      return 'Stripe must be configured to extend trials.';
    }

    return 'Stripe only supports extending active trial_end values through this tool.';
  }, [stripeConfigured]);

  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-app-text">Actions</h2>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          theme="app"
          onClick={() => {
            setPlan(currentPlan);
            setPlanOpen(true);
          }}>
          Change plan
        </Button>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          theme="app"
          disabled={!hasStripeSubscription}
          onClick={() => setTrialOpen(true)}>
          Extend trial
        </Button>
      </div>

      <p className="mt-3 text-xs text-app-text-muted">
        Trial extensions only work for Stripe-managed trials. Support-only local
        overrides can still use manual plan changes.
      </p>

      <AppModalBackdrop
        open={planOpen}
        onClose={() => {
          if (!isPending) setPlanOpen(false);
        }}
        panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <h2 className="text-lg font-medium text-app-text">Change plan</h2>
          <p className="mt-1 text-sm text-app-text-muted">
            Capture a reason for this manual subscription change.
          </p>

          <label className="mt-4 block text-xs font-medium text-app-text-secondary">
            Plan
          </label>
          <Select
            theme="app"
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
            className="mt-1">
            <option value="free">Free</option>
            <option value="pro">Pro</option>
          </Select>

          <label className="mt-3 block text-xs font-medium text-app-text-secondary">
            Reason
          </label>
          <Textarea
            theme="app"
            value={planReason}
            onChange={(event) => setPlanReason(event.target.value)}
            className="mt-1"
            rows={3}
            placeholder="Explain why this plan change is needed..."
          />

          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              theme="app"
              disabled={isPending}
              onClick={() => setPlanOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              theme="app"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await changeSubscriptionPlanAction({
                    userId,
                    newPlan: plan === 'pro' ? 'pro' : 'free',
                    reason: planReason,
                  });

                  if ('error' in result) {
                    toast.error(result.error);
                    return;
                  }

                  toast.success('Plan updated.');
                  setPlanOpen(false);
                  setPlanReason('');
                  router.refresh();
                })
              }>
              {isPending ? 'Working...' : 'Save change'}
            </Button>
          </div>
        </div>
      </AppModalBackdrop>

      <AppModalBackdrop
        open={trialOpen}
        onClose={() => {
          if (!isPending) setTrialOpen(false);
        }}
        panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <h2 className="text-lg font-medium text-app-text">Extend trial</h2>
          <p className="mt-1 text-sm text-app-text-muted">{trialHelpText}</p>

          <label className="mt-4 block text-xs font-medium text-app-text-secondary">
            New trial end
          </label>
          <Input
            theme="app"
            type="datetime-local"
            value={trialEnd}
            onChange={(event) => setTrialEnd(event.target.value)}
            className="mt-1"
          />

          <label className="mt-3 block text-xs font-medium text-app-text-secondary">
            Reason
          </label>
          <Textarea
            theme="app"
            value={trialReason}
            onChange={(event) => setTrialReason(event.target.value)}
            className="mt-1"
            rows={3}
            placeholder="Explain why the trial is being extended..."
          />

          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              theme="app"
              disabled={isPending}
              onClick={() => setTrialOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              theme="app"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await extendSubscriptionTrialAction({
                    userId,
                    newTrialEnd: trialEnd,
                    reason: trialReason,
                  });

                  if ('error' in result) {
                    toast.error(result.error);
                    return;
                  }

                  toast.success('Trial updated.');
                  setTrialOpen(false);
                  setTrialReason('');
                  router.refresh();
                })
              }>
              {isPending ? 'Working...' : 'Save extension'}
            </Button>
          </div>
        </div>
      </AppModalBackdrop>
    </div>
  );
}
