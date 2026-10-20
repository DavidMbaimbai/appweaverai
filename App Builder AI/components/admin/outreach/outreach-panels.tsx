'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { reviewInteractionAction, reviewLeadAction } from '@/lib/admin/actions/outreach';
import { focusRingStyles, inputStyles } from '@/lib/ui-theme';
import { cn } from '@/lib/utils';

const fieldClass = cn(
  'w-full rounded-xl border px-3.5 py-2.5 text-sm transition-[border-color,box-shadow]',
  inputStyles.app,
  focusRingStyles.app,
);

export function InteractionReviewPanel({
  id,
  initialReply,
  canWrite,
}: {
  id: string;
  initialReply: string;
  canWrite: boolean;
}) {
  const [reply, setReply] = useState(initialReply);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  if (!canWrite) return null;

  const run = (action: 'approve' | 'reject') =>
    startTransition(async () => {
      const result = await reviewInteractionAction(
        id,
        action === 'approve' ? { action, reply } : { action },
      );
      if ('error' in result) toast.error(result.error);
      else toast.success(action === 'approve' ? 'Reply sent.' : 'Skipped.');
    });

  return (
    <div className="mt-3 space-y-2 border-t border-app-border-subtle pt-3">
      <textarea
        className={cn(fieldClass, 'min-h-24')}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="Reply to send…"
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" theme="app" disabled={pending || !reply.trim()} onClick={() => run('approve')}>
          {pending ? 'Working…' : 'Approve & send'}
        </Button>
        <Button type="button" size="sm" variant="ghost" theme="app" disabled={pending} onClick={() => run('reject')}>
          Skip
        </Button>
      </div>
    </div>
  );
}

export function LeadReviewPanel({
  id,
  initialSubject,
  initialBody,
  footerPreview,
  canWrite,
}: {
  id: string;
  initialSubject: string;
  initialBody: string;
  /** Exact footer appended to the sent email, or null when outreach isn't configured. */
  footerPreview: string | null;
  canWrite: boolean;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const run = (
    review:
      | { action: 'approve'; subject: string; body: string }
      | { action: 'reject' }
      | { action: 'do-not-contact' },
    done: string,
  ) =>
    startTransition(async () => {
      const result = await reviewLeadAction(id, review);
      if ('error' in result) toast.error(result.error);
      else toast.success(done);
    });

  return (
    <div className="mt-3 space-y-2 border-t border-app-border-subtle pt-3">
      <input
        className={fieldClass}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={!canWrite}
        aria-label="Subject"
      />
      <textarea
        className={cn(fieldClass, 'min-h-40')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!canWrite}
        aria-label="Email body"
      />
      <p className="whitespace-pre-wrap rounded-lg bg-app-surface-active/40 p-3 text-xs text-app-text-muted">
        {footerPreview ?? 'Footer unavailable: set OUTREACH_POSTAL_ADDRESS (sending is blocked until then).'}
      </p>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            theme="app"
            disabled={pending || !subject.trim() || !body.trim() || !footerPreview}
            onClick={() => run({ action: 'approve', subject, body }, 'Email sent.')}>
            {pending ? 'Working…' : 'Approve & send'}
          </Button>
          <Button type="button" size="sm" variant="ghost" theme="app" disabled={pending} onClick={() => run({ action: 'reject' }, 'Rejected.')}>
            Reject
          </Button>
          <Button type="button" size="sm" variant="ghost" theme="app" disabled={pending} onClick={() => run({ action: 'do-not-contact' }, 'Added to do-not-contact.')}>
            Do not contact
          </Button>
        </div>
      ) : null}
    </div>
  );
}
