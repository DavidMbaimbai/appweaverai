'use client';

import { useMemo, useState } from 'react';

import {
  dayKey,
  ghostButton,
  STATUS_LABELS,
  STATUS_STYLES,
  timeOf,
  type ReleaseView,
} from './types';

type Mode = 'day' | 'week' | 'month';

const DAY_MS = 86_400_000;

type Props = {
  releases: ReleaseView[];
  displayZone: string;
  onSelect: (release: ReleaseView) => void;
  /** Move a release to another calendar day (keeps its own local wall-clock time). */
  onMove: (release: ReleaseView, day: string) => void;
};

export function ReleaseCalendar({ releases, displayZone, onSelect, onMove }: Props) {
  const [mode, setMode] = useState<Mode>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [over, setOver] = useState<string | null>(null);

  const days = useMemo(() => {
    const base = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
    if (mode === 'day') return [base];
    if (mode === 'week') {
      const offset = (base.getUTCDay() + 6) % 7;
      return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + (i - offset) * DAY_MS));
    }
    const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const start = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY_MS);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }, [cursor, mode]);

  const byDay = useMemo(() => {
    const map = new Map<string, ReleaseView[]>();
    for (const r of releases) {
      const key = dayKey(new Date(r.scheduledAt), displayZone);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return map;
  }, [releases, displayZone]);

  function shift(direction: number) {
    const next = new Date(cursor);
    if (mode === 'month') next.setUTCMonth(next.getUTCMonth() + direction);
    else next.setUTCDate(next.getUTCDate() + direction * (mode === 'week' ? 7 : 1));
    setCursor(next);
  }

  const title = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
    ...(mode !== 'month' ? { day: 'numeric' } : {}),
  }).format(cursor);
  const today = dayKey(new Date(), displayZone);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghostButton} onClick={() => shift(-1)} aria-label="Previous">
          ‹
        </button>
        <button type="button" className={ghostButton} onClick={() => setCursor(new Date())}>
          Today
        </button>
        <button type="button" className={ghostButton} onClick={() => shift(1)} aria-label="Next">
          ›
        </button>
        <h2 className="mx-2 text-sm font-semibold text-app-text">{title}</h2>
        <div className="ml-auto flex gap-1">
          {(['day', 'week', 'month'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`${ghostButton} ${mode === m ? 'bg-app-surface-hover font-medium' : ''}`}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className={mode === 'day' ? 'grid grid-cols-1 gap-1' : 'grid grid-cols-7 gap-1'}>
        {mode !== 'day' &&
          ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="px-1 text-xs font-medium text-app-text-muted">
              {d}
            </div>
          ))}
        {days.map((date) => {
          const key = date.toISOString().slice(0, 10);
          const items = byDay.get(key) ?? [];
          const dim = mode === 'month' && date.getUTCMonth() !== cursor.getUTCMonth();
          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(key);
              }}
              onDragLeave={() => setOver((v) => (v === key ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/release-id');
                const release = releases.find((r) => r.id === id);
                if (release) onMove(release, key);
              }}
              className={`min-h-24 rounded-lg border p-1.5 ${
                over === key ? 'border-appweaver-orange bg-appweaver-orange/10' : 'border-app-border-subtle'
              } ${dim ? 'opacity-50' : ''} ${key === today ? 'ring-1 ring-appweaver-orange' : ''}`}>
              <div className="mb-1 text-xs text-app-text-muted">{date.getUTCDate()}</div>
              <ul className="space-y-1">
                {items.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      draggable={['DRAFT', 'SCHEDULED', 'APPROVED', 'PAUSED'].includes(r.status)}
                      onDragStart={(e) => e.dataTransfer.setData('text/release-id', r.id)}
                      onClick={() => onSelect(r)}
                      title={`${r.title} · ${STATUS_LABELS[r.status]}`}
                      className={`w-full truncate rounded px-1.5 py-0.5 text-left text-xs ${STATUS_STYLES[r.status]}`}>
                      {timeOf(new Date(r.scheduledAt), displayZone)} {r.platform.slice(0, 2)}
                      {r.episode ? ` E${r.episode}` : ''} {r.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-app-text-muted">
        Times shown in {displayZone}. Drag a release to another day to reschedule it; it keeps its own local time and
        needs re-approval.
      </p>
    </section>
  );
}
