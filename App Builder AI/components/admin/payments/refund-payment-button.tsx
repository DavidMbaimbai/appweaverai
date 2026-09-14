'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { formatCurrencyCents } from '@/components/admin/ui/primitives';
import { refundPaymentAction } from '@/lib/admin/actions/payments';

function centsToInputValue(cents: number) {
  return (cents / 100).toFixed(2);
}

export function RefundPaymentButton({
  chargeId,
  maxRefundableAmountCents,
  currency,
}: {
  chargeId: string;
  maxRefundableAmountCents: number;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(
    centsToInputValue(maxRefundableAmountCents),
  );
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (maxRefundableAmountCents <= 0) {
    return null;
  }

  function handleClose() {
    if (!isPending) {
      setOpen(false);
    }
  }

  function handleSubmit() {
    if (!reason.trim()) {
      toast.error('A reason is required.');
      return;
    }

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast.error('Enter a valid refund amount.');
      return;
    }

    const amountCents = Math.round(amountNumber * 100);
    if (amountCents > maxRefundableAmountCents) {
      toast.error('Refund amount exceeds the remaining refundable balance.');
      return;
    }

    startTransition(async () => {
      const result = await refundPaymentAction({
        chargeId,
        reason,
        amountCents,
      });

      if ('error' in result) {
        toast.error(result.error);
        return;
      }

      toast.success('Refund created.');
      setOpen(false);
      setReason('');
      setAmount(centsToInputValue(maxRefundableAmountCents));
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="primary"
        theme="app"
        onClick={() => setOpen(true)}>
        Refund payment
      </Button>

      <AppModalBackdrop
        open={open}
        onClose={handleClose}
        panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <h2 className="text-lg font-medium text-app-text">Create refund</h2>
          <p className="mt-1 text-sm text-app-text-muted">
            Remaining refundable balance:{' '}
            {formatCurrencyCents(maxRefundableAmountCents, currency)}.
          </p>

          <label className="mt-4 block text-xs font-medium text-app-text-secondary">
            Refund amount
          </label>
          <Input
            theme="app"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-1"
          />

          <label className="mt-3 block text-xs font-medium text-app-text-secondary">
            Reason
          </label>
          <Textarea
            theme="app"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1"
            rows={3}
            placeholder="Explain why this refund is being issued..."
          />

          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              theme="app"
              disabled={isPending}
              onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              theme="app"
              disabled={isPending}
              onClick={handleSubmit}>
              {isPending ? 'Processing...' : 'Confirm refund'}
            </Button>
          </div>
        </div>
      </AppModalBackdrop>
    </>
  );
}
