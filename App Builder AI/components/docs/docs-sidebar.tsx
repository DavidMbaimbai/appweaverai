'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { docsCategories, docsArticles } from '@/lib/docs-data';
import { cn } from '@/lib/utils';

export function DocsSidebar({ activeSlug }: { activeSlug?: string }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docsArticles;
    return docsArticles.filter(
      (article) =>
        article.title.toLowerCase().includes(q) ||
        article.summary.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <nav className="w-full shrink-0 desktop:w-[260px]">
      <div className="sticky top-24">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search docs..."
          aria-label="Search documentation"
          className="w-full rounded-lg border border-border-light bg-surface-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-appweaver-orange/40"
        />

        <div className="mt-6 max-h-[70vh] space-y-6 overflow-y-auto pr-1">
          {docsCategories.map((category) => {
            const articles = filtered.filter(
              (article) => article.category === category.id,
            );
            if (articles.length === 0) return null;

            return (
              <div key={category.id}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-text-dim">
                  {category.title}
                </p>
                <ul className="space-y-1">
                  {articles.map((article) => (
                    <li key={article.slug}>
                      <Link
                        href={`/docs/${article.slug}`}
                        className={cn(
                          'block rounded-md px-2.5 py-1.5 text-sm transition-colors',
                          activeSlug === article.slug
                            ? 'bg-[#fdf1ea] text-appweaver-orange font-medium'
                            : 'text-text-secondary hover:bg-surface-dim hover:text-text-primary',
                        )}>
                        {article.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-text-muted">No results for “{query}”.</p>
          )}
        </div>
      </div>
    </nav>
  );
}
