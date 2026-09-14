'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  respondToFeedbackAction,
  updateFeedbackStatusAction,
} from '@/lib/admin/actions/feedback';
import type { FeedbackStatus } from '@/lib/generated/prisma/client';
import { inputStyles, focusRingStyles } from '@/lib/ui-theme';
import { cn } from '@/lib/utils';

export function FeedbackReplyPanel({
  id,
  existingResponse,
  status,
}: {
  id: string;
  existingResponse: string | null;
  status: FeedbackStatus;
}) {
  const [response, setResponse] = useState('');
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <div className="mt-3 space-y-2 border-t border-app-border-subtle pt-3">
      <textarea
        className={cn(
          'min-h-20 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-[border-color,box-shadow]',
          inputStyles.app,
          focusRingStyles.app,
        )}
        placeholder={existingResponse ? 'Send an updated response…' : 'Write a response…'}
        value={response}
        onChange={(e) => setResponse(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          theme="app"
          disabled={isPending || !response.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await respondToFeedbackAction(id, response);
              if ('error' in result) {
                toast.error(result.error);
                return;
              }
              toast.success('Response sent.');
              setResponse('');
            })
          }>
          {isPending ? 'Sending…' : 'Send response'}
        </Button>

        {status === 'NEW' ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            theme="app"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateFeedbackStatusAction(id, 'READ');
                if ('error' in result) toast.error(result.error);
              })
            }>
            Mark as read
          </Button>
        ) : null}
      </div>
    </div>
  );
}
