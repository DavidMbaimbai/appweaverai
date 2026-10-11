'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';
import { useToast } from '@/components/ui/toast';
import { formatRelativeTime } from '@/lib/app-utils';
import { setNotificationEmailAction } from '@/lib/actions/projects';
import { trackSave } from '@/lib/save-tracker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type FormSubmission = {
  id: string;
  formName: string;
  data: Record<string, unknown>;
  createdAt: string;
};

type FormSubmissionsPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
};

export function FormSubmissionsPanel({
  open,
  onClose,
  projectId,
}: FormSubmissionsPanelProps) {
  const { error: toastError, success } = useToast();
  const [notificationEmail, setNotificationEmail] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  async function handleSaveEmail() {
    setIsSavingEmail(true);
    const result = await trackSave(
      setNotificationEmailAction(projectId, notificationEmail),
    );
    setIsSavingEmail(false);
    if ('error' in result && result.error) {
      toastError(result.error);
      return;
    }
    success(
      notificationEmail.trim()
        ? 'Notification email saved.'
        : 'Notifications will go to your account email.',
    );
  }
  const [isLoading, setIsLoading] = useState(true);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/forms`);
        const data = await res.json();
        if (cancelled) return;
        setSubmissions(data.submissions ?? []);
        setNotificationEmail(data.notificationEmail ?? '');
      } catch {
        if (!cancelled) toastError('Could not load form submissions.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">
              Form submissions
            </h2>
            <p className="mt-0.5 text-xs text-app-text-muted">
              Messages sent through contact/lead forms on your live site.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-app-text-muted transition-colors hover:text-app-text">
            Close
          </button>
        </div>

        <div className="border-b border-app-border-subtle px-5 py-3">
          <label className="block text-xs font-medium text-app-text-secondary">
            Send new submissions to
            <div className="mt-1 flex gap-2">
              <Input
                type="email"
                value={notificationEmail}
                onChange={(event) => setNotificationEmail(event.target.value)}
                placeholder="Leave blank to use your account email"
                theme="app"
                className="h-9 flex-1"
              />
              <Button
                type="button"
                theme="app"
                disabled={isSavingEmail}
                onClick={handleSaveEmail}>
                {isSavingEmail ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              Loading…
            </p>
          ) : submissions.length === 0 ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              No submissions yet. They&apos;ll show up here as soon as a
              visitor submits a form on your published site.
            </p>
          ) : (
            <ul className="space-y-3">
              {submissions.map((submission) => (
                <li
                  key={submission.id}
                  className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-app-text-muted">
                      {submission.formName}
                    </span>
                    <span className="text-xs text-app-text-muted">
                      {formatRelativeTime(submission.createdAt)}
                    </span>
                  </div>
                  <dl className="mt-2 space-y-1">
                    {Object.entries(submission.data).map(([key, value]) => (
                      <div key={key} className="text-sm">
                        <dt className="inline font-medium text-app-text-secondary">
                          {key}:{' '}
                        </dt>
                        <dd className="inline break-words text-app-text">
                          {String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppModalBackdrop>
  );
}
