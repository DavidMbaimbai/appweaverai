'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Newest' },
  { value: 'popular', label: 'Most viewed' },
  { value: 'remixed', label: 'Most remixed' },
] as const;

export function GalleryFilters({ categories }: { categories: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const sort = searchParams.get('sort') ?? 'recent';
  const category = searchParams.get('category') ?? '';

  const applyParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      startTransition(() => {
        router.push(`/app/explore?${params.toString()}`);
      });
    },
    [router, searchParams],
  );

  // Debounce the search box so we're not pushing a new URL on every keystroke.
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (search === current) return;
    const timeout = setTimeout(() => applyParams({ q: search || null }), 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-col gap-3 tablet-up:flex-row tablet-up:items-center">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search published apps…"
          className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text placeholder:text-app-text-muted tablet-up:max-w-sm"
        />

        <div className="flex items-center gap-2">
          <label className="text-xs text-app-text-muted" htmlFor="gallery-sort">
            Sort
          </label>
          <select
            id="gallery-sort"
            value={sort}
            onChange={(event) => applyParams({ sort: event.target.value })}
            className="rounded-lg border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text">
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {isPending && (
          <span className="text-xs text-app-text-muted">Loading…</span>
        )}
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyParams({ category: null })}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              category === ''
                ? 'border-app-accent-blue bg-app-accent-blue/10 text-app-accent-blue'
                : 'border-app-border text-app-text-muted hover:text-app-text'
            }`}>
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => applyParams({ category: cat })}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                category === cat
                  ? 'border-app-accent-blue bg-app-accent-blue/10 text-app-accent-blue'
                  : 'border-app-border text-app-text-muted hover:text-app-text'
              }`}>
              {cat.toLowerCase().replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
