'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { inputStyles, focusRingStyles } from '@/lib/ui-theme';
import {
  getMyFeedbackMessagesAction,
  submitFeedbackMessageAction,
  submitProductReviewAction,
} from '@/lib/feedback/actions';

type FeedbackMessageItem = {
  id: string;
  message: string;
  status: string;
  response: string | null;
  translatedResponse: string | null;
  language: string | null;
  respondedAt: Date | string | null;
  createdAt: Date | string;
};

type Tab = 'message' | 'review';

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('message');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-appweaver-orange px-5 py-3 text-sm font-medium text-white shadow-lg transition-transform hover:scale-105 hover:bg-appweaver-orange-mid"
        aria-label="Send feedback">
        <span aria-hidden>💬</span>
        Feedback
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 p-4 sm:items-center sm:justify-center"
          onClick={() => setOpen(false)}>
          <div
            className="app-theme flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-app-border-subtle bg-app-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
              <h2 className="text-sm font-semibold text-app-text">
                Talk to AppWeaver AI
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-app-text-muted hover:text-app-text"
                aria-label="Close">
                ✕
              </button>
            </div>

            <div className="flex border-b border-app-border-subtle px-5">
              <TabButton active={tab === 'message'} onClick={() => setTab('message')}>
                Send feedback
              </TabButton>
              <TabButton active={tab === 'review'} onClick={() => setTab('review')}>
                Rate the app
              </TabButton>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {tab === 'message' ? <MessageTab /> : <ReviewTab />}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'border-appweaver-orange text-app-text'
          : 'border-transparent text-app-text-muted hover:text-app-text',
      )}>
      {children}
    </button>
  );
}

function MessageTab() {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<FeedbackMessageItem[]>([]);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  useEffect(() => {
    getMyFeedbackMessagesAction()
      .then((items) => setHistory(items))
      .catch(() => {});
  }, []);

  const send = () => {
    startTransition(async () => {
      const result = await submitFeedbackMessageAction(message);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      toast.success('Thanks! Your feedback was sent to the team.');
      setMessage('');
      const items = await getMyFeedbackMessagesAction().catch(() => []);
      setHistory(items);
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <textarea
          className={cn(
            'min-h-24 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-[border-color,box-shadow]',
            inputStyles.app,
            focusRingStyles.app,
          )}
          placeholder="Tell us what's on your mind — bugs, ideas, or anything else."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          theme="app"
          className="mt-2 w-full"
          disabled={isPending || !message.trim()}
          onClick={send}>
          {isPending ? 'Sending…' : 'Send to the team'}
        </Button>
      </div>

      {history.length > 0 ? (
        <div className="space-y-3 border-t border-app-border-subtle pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-app-text-muted">
            Your messages
          </p>
          {history.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-app-border-subtle bg-app-bg/40 p-3 text-sm">
              <p className="text-app-text-secondary">{item.message}</p>
              {item.response ? (
                <div className="mt-2 rounded-md bg-app-surface-active/50 p-2">
                  <p className="text-xs font-medium text-app-text-muted">
                    Reply from AppWeaver AI
                  </p>
                  <p className="mt-1 text-app-text">
                    {item.translatedResponse ?? item.response}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-app-text-muted">Awaiting a reply…</p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewTab() {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const send = () => {
    if (rating < 1) {
      toast.error('Please choose a star rating.');
      return;
    }
    startTransition(async () => {
      const result = await submitProductReviewAction(rating, comment);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      toast.success('Thanks for the review!');
      setRating(0);
      setComment('');
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-1 text-3xl">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            className={cn(
              'transition-transform hover:scale-110',
              star <= rating ? 'text-appweaver-orange' : 'text-app-border',
            )}>
            ★
          </button>
        ))}
      </div>
      <textarea
        className={cn(
          'min-h-20 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-[border-color,box-shadow]',
          inputStyles.app,
          focusRingStyles.app,
        )}
        placeholder="What do you like — or what could be better? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <Button
        type="button"
        size="sm"
        theme="app"
        className="w-full"
        disabled={isPending}
        onClick={send}>
        {isPending ? 'Submitting…' : 'Submit review'}
      </Button>
    </div>
  );
}
