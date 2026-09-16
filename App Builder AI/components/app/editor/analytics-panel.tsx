'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';

type AnalyticsSummary = {
  totalViews: number;
  uniqueVisitors: number;
  viewsLast7Days: { date: string; count: number }[];
  topPaths: { path: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
};

type AnalyticsPanelProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  isPublished: boolean;
};

function formatDayLabel(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

/**
 * Owner-facing view of public traffic to a published project: total views,
 * rough unique-visitor count, a 7-day trend, and top pages/referrers.
 * Sourced from ProjectPageView rows recorded on every anonymous visit to
 * the project's /p/... URL (lib/analytics/record-page-view.ts) — most
 * AI app-builder competitors don't expose any post-publish analytics at
 * all, so this is a genuine differentiator, not just parity.
 */
export function AnalyticsPanel({
  open,
  onClose,
  projectId,
  isPublished,
}: AnalyticsPanelProps) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load(showLoading: boolean) {
      if (showLoading) setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/analytics`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as AnalyticsSummary;
        if (cancelled) return;
        setSummary(data);
      } catch {
        // Best-effort — keep showing the last known summary on failure.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(true);
    const interval = setInterval(() => void load(false), 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, projectId]);

  const maxDailyCount = summary
    ? Math.max(1, ...summary.viewsLast7Days.map((d) => d.count))
    : 1;

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-lg text-app-text">Analytics</h2>
            <p className="mt-0.5 text-xs text-app-text-muted">
              Public traffic to your published app — updates automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-app-text-muted transition-colors hover:text-app-text">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!isPublished ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              Publish this project to start collecting visitor analytics.
            </p>
          ) : isLoading && !summary ? (
            <p className="py-6 text-center text-sm text-app-text-muted">
              Loading…
            </p>
          ) : summary ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3">
                  <p className="text-2xl font-semibold text-app-text">
                    {summary.totalViews.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs text-app-text-muted">
                    Total views
                  </p>
                </div>
                <div className="rounded-xl border border-app-border-subtle bg-app-surface-active px-4 py-3">
                  <p className="text-2xl font-semibold text-app-text">
                    {summary.uniqueVisitors.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs text-app-text-muted">
                    Unique visitors
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-app-text-muted">
                  Last 7 days
                </p>
                <div className="flex h-24 items-end gap-2 rounded-xl border border-app-border-subtle bg-app-surface-active px-3 py-3">
                  {summary.viewsLast7Days.map((day) => (
                    <div
                      key={day.date}
                      className="flex flex-1 flex-col items-center gap-1"
                      title={`${day.date}: ${day.count} view${day.count === 1 ? '' : 's'}`}>
                      <div className="flex h-16 w-full items-end">
                        <div
                          className="w-full rounded-t bg-appweaver-orange/80"
                          style={{
                            height: `${Math.max(4, (day.count / maxDailyCount) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-app-text-muted">
                        {formatDayLabel(day.date)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-app-text-muted">
                  Top pages
                </p>
                {summary.topPaths.length === 0 ? (
                  <p className="text-xs text-app-text-muted">
                    No visits yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {summary.topPaths.map((row) => (
                      <li
                        key={row.path}
                        className="flex items-center justify-between gap-3 rounded-lg border border-app-border-subtle bg-app-surface-active px-3 py-2 text-xs">
                        <span className="min-w-0 truncate text-app-text-secondary">
                          {row.path}
                        </span>
                        <span className="shrink-0 font-medium text-app-text">
                          {row.count.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-app-text-muted">
                  Top referrers
                </p>
                {summary.topReferrers.length === 0 ? (
                  <p className="text-xs text-app-text-muted">
                    No referrer data yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {summary.topReferrers.map((row) => (
                      <li
                        key={row.referrer}
                        className="flex items-center justify-between gap-3 rounded-lg border border-app-border-subtle bg-app-surface-active px-3 py-2 text-xs">
                        <span className="min-w-0 truncate text-app-text-secondary">
                          {row.referrer}
                        </span>
                        <span className="shrink-0 font-medium text-app-text">
                          {row.count.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AppModalBackdrop>
  );
}
