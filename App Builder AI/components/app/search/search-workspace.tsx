'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { persistHeroPromptState } from '@/lib/hero-prompt-draft';

type SearchMode = 'answer' | 'research';
type SearchSource = {
  title: string;
  url: string;
  description: string;
  excerpt: string;
};
type SearchResult = {
  query: string;
  mode: SearchMode;
  answer: string;
  sources: SearchSource[];
  model?: string;
};

const HISTORY_KEY = 'appweaver-search-history';

export function SearchWorkspace() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('answer');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
      return Array.isArray(saved)
        ? saved
            .filter((item): item is string => typeof item === 'string')
            .slice(0, 10)
        : [];
    } catch {
      return [];
    }
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function search(nextQuery = query) {
    const clean = nextQuery.trim();
    if (clean.length < 2 || pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: clean, mode }),
      });
      const data = (await response.json()) as SearchResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Search failed.');
      setResult(data);
      setQuery(clean);
      const nextHistory = [clean, ...history.filter((item) => item !== clean)].slice(0, 10);
      setHistory(nextHistory);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Search failed.');
    } finally {
      setPending(false);
    }
  }

  async function buildFromSearch() {
    if (!result) return;
    await persistHeroPromptState({
      value: `Using this research, build a working product:\n\nQuestion: ${result.query}\n\nFindings:\n${result.answer}`,
      categoryId: null,
      planMode: true,
      attachments: [],
      autostart: false,
    });
    router.push('/app');
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-medium text-appweaver-orange">AppWeaver AI Search</p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-app-text">
            Search anything. Build from what you find.
          </h1>
          <p className="mt-3 text-app-text-muted">
            Ask a question, research a market, compare products, find technical answers, or explore an opportunity. AppWeaver searches the web, explains the evidence, and can turn the result into a product.
          </p>

          <form
            className="mt-8 rounded-2xl border border-app-border bg-app-surface p-3 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}>
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="What do you want to understand or build?"
              rows={3}
              className="w-full resize-none bg-transparent p-2 text-base text-app-text outline-none placeholder:text-app-text-muted"
              disabled={pending}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border-subtle pt-3">
              <div className="flex gap-1">
                {(['answer', 'research'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={`rounded-lg px-3 py-1.5 text-xs ${mode === item ? 'bg-app-surface-active text-app-text' : 'text-app-text-muted hover:text-app-text'}`}>
                    {item === 'answer' ? 'Quick answer' : 'Deep research'}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={pending || query.trim().length < 2}
                className="rounded-lg bg-app-accent-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {pending ? 'Researching…' : 'Search'}
              </button>
            </div>
          </form>

          {history.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {history.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setQuery(item);
                    void search(item);
                  }}
                  className="max-w-full truncate rounded-full border border-app-border-subtle px-3 py-1 text-xs text-app-text-muted hover:text-app-text">
                  {item}
                </button>
              ))}
            </div>
          ) : null}

          {error ? <p className="mt-6 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</p> : null}

          {result ? (
            <div className="mt-8 space-y-6">
              <section className="rounded-2xl border border-app-border bg-app-surface p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-xl text-app-text">Answer</h2>
                  <button
                    type="button"
                    onClick={() => void buildFromSearch()}
                    className="rounded-lg border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover">
                    Build from this research
                  </button>
                </div>
                <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-app-text-secondary">
                  {result.answer}
                </div>
                {result.model ? <p className="mt-4 text-xs text-app-text-muted">Answered with {result.model}</p> : null}
              </section>

              <section>
                <h2 className="mb-3 font-display text-xl text-app-text">Sources</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {result.sources.map((source, index) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="rounded-xl border border-app-border-subtle p-4 hover:bg-app-surface-hover">
                      <p className="text-xs text-app-text-muted">[{index + 1}]</p>
                      <p className="mt-1 line-clamp-2 text-sm font-medium text-app-text">{source.title || source.url}</p>
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-app-text-muted">{source.description || source.excerpt}</p>
                    </a>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="mt-10 grid gap-3 text-sm text-app-text-muted md:grid-cols-3">
              <div className="rounded-xl border border-app-border-subtle p-4">Compare tools and products</div>
              <div className="rounded-xl border border-app-border-subtle p-4">Research markets and opportunities</div>
              <div className="rounded-xl border border-app-border-subtle p-4">Find technical answers and APIs</div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
