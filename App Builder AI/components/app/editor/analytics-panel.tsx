'use client';

import { useEffect, useState } from 'react';

import { AppModalBackdrop } from '@/components/ui/app-modal';

type AnalyticsSummary = {
  totalViews: number;
  uniqueVisitors: number;
  activeUsers: number;
  sessions: number;
  keyEvents: number;
  newUsers: number;
  viewsLast30Days: { date: string; count: number }[];
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
  return date.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
  });
}

/**
 * Owner-facing view of public traffic to a published project: total views,
 * active-user metrics, a 30-day trend, and top pages/referrers.
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
    ? Math.max(1, ...summary.viewsLast30Days.map((d) => d.count))
    : 1;
  const chartPoints = summary
    ? summary.viewsLast30Days.map((day, index, days) => {
        const x = days.length === 1 ? 50 : (index / (days.length - 1)) * 100;
        const y = 100 - (day.count / maxDailyCount) * 82 - 8;
        return { ...day, x, y };
      })
    : [];
  const chartPath = chartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  return (
    <AppModalBackdrop
      open={open}
      onClose={onClose}
      panelClassName="fixed inset-0 z-10 flex items-center justify-center p-4">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
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
              <div className="grid grid-cols-2 divide-x divide-app-border-subtle overflow-hidden rounded-xl border border-app-border-subtle bg-app-surface-active tablet-up:grid-cols-4">
                {[
                  ['Active users', summary.activeUsers],
                  ['Sessions', summary.sessions],
                  ['Key events', summary.keyEvents],
                  ['New users', summary.newUsers],
                ].map(([label, value]) => (
                  <div key={label} className="px-4 py-3">
                    <p className="flex items-center gap-1 text-xs font-medium text-blue-500">
                      {label}
                      <span className="text-app-text-muted">⌄</span>
                    </p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-app-text">
                      {Number(value).toLocaleString()}
                    </p>
                    <p className="text-xs text-app-text-muted">—</p>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-xl border border-app-border-subtle bg-app-surface-active">
                <div className="flex items-center justify-between border-b border-app-border-subtle px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-app-text">
                      User activity
                    </p>
                    <p className="text-xs text-app-text-muted">
                      Traffic and engagement over time
                    </p>
                  </div>
                  <select
                    aria-label="Analytics date range"
                    defaultValue="30"
                    className="rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text-muted outline-none">
                    <option value="30">Last 30 days</option>
                    <option value="7">Last 7 days</option>
                  </select>
                </div>
                <div className="relative px-4 pb-3 pt-5">
                  <div className="pointer-events-none absolute left-20 right-4 top-5 flex h-40 flex-col justify-between text-[10px] text-app-text-muted/70">
                    {[maxDailyCount, Math.round(maxDailyCount * 0.66), Math.round(maxDailyCount * 0.33), 0].map((value) => (
                      <div key={value} className="flex items-center gap-2">
                        <span className="w-8 text-right">{value.toLocaleString()}</span>
                        <span className="h-px flex-1 bg-app-border-subtle" />
                      </div>
                    ))}
                  </div>
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="ml-12 h-40 w-[calc(100%-3rem)] overflow-visible"
                    role="img"
                    aria-label="Analytics activity trend">
                    <path
                      d={chartPath}
                      fill="none"
                      stroke="rgb(66 133 244)"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                    {chartPoints.map((point) => (
                      <circle
                        key={point.date}
                        cx={point.x}
                        cy={point.y}
                        r="1.8"
                        fill="rgb(66 133 244)"
                        vectorEffect="non-scaling-stroke">
                        <title>
                          {point.date}: {point.count.toLocaleString()} views
                        </title>
                      </circle>
                    ))}
                  </svg>
                  <div className="ml-12 flex justify-between text-[10px] text-app-text-muted">
                    {chartPoints.filter((_, index) => index % 7 === 0 || index === chartPoints.length - 1).map((point) => (
                      <span key={point.date}>{formatDayLabel(point.date)}</span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-4 text-xs text-app-text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-4 bg-blue-500" />
                      Current period
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm text-appweaver-orange">
                    <span>Ad spend: no data</span>
                    <span>Organic marketing: no campaign data</span>
                  </div>
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
