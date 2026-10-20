'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { importDesignAction } from '@/lib/actions/design-import';

type Tab = 'figma' | 'url' | 'screenshot' | 'github';

const TABS: Array<{ id: Tab; label: string; outcome: string; blurb: string }> = [
  {
    id: 'figma',
    label: 'Figma',
    outcome: 'Imported design',
    blurb:
      'Paste a Figma file or frame link and a personal access token. Frames, colours, fonts and components become editable components.',
  },
  {
    id: 'url',
    label: 'Website URL',
    outcome: 'Imported design',
    blurb:
      'Enter a public website. We read its title, headings, colours, fonts and structure and recreate it as editable components.',
  },
  {
    id: 'screenshot',
    label: 'Screenshot',
    outcome: 'Visual reference',
    blurb:
      'Upload an image. It is attached to your project as a reference the builder looks at; results are an interpretation, not an exact copy.',
  },
  {
    id: 'github',
    label: 'GitHub',
    outcome: 'Functional imported application',
    blurb:
      'Import an existing repository with its real code and keep building. Coming from Lovable or another builder? Sync that project to GitHub first, then import the repo here.',
  },
];

const inputClass =
  'w-full rounded-xl border border-black/10 bg-white px-4 py-3 font-display text-base text-text-agent-heading outline-none focus:border-appweaver-orange';

export function DesignImportTabs() {
  const [tab, setTab] = useState<Tab>('figma');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = TABS.find((t) => t.id === tab)!;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('kind', tab);
    setError(null);
    startTransition(async () => {
      const result = await importDesignAction(form);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="mx-auto w-full max-w-[720px] rounded-[20px] bg-white p-6 text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setError(null);
            }}
            className={`rounded-full px-4 py-2 font-display text-sm ${
              tab === t.id
                ? 'bg-appweaver-orange text-white'
                : 'bg-black/5 text-text-agent-heading hover:bg-black/10'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <p className="mt-4 font-display text-xs uppercase tracking-[0.15em] text-appweaver-orange">
        Outcome: {active.outcome}
      </p>
      <p className="mt-1 font-display text-base text-text-dim">{active.blurb}</p>

      {tab === 'github' ? (
        <Link
          href="/app"
          className="mt-5 inline-flex h-[45px] items-center rounded-full bg-appweaver-orange px-6 font-display text-white">
          Import from GitHub
        </Link>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
          {tab === 'figma' && (
            <>
              <input
                name="figmaUrl"
                required
                placeholder="https://www.figma.com/design/…"
                className={inputClass}
              />
              <input
                name="figmaToken"
                type="password"
                required
                autoComplete="off"
                placeholder="Figma personal access token"
                className={inputClass}
              />
              <p className="font-display text-sm text-text-dim">
                Your token is used once for this import and is never saved.
              </p>
            </>
          )}
          {tab === 'url' && (
            <input
              name="websiteUrl"
              required
              placeholder="https://example.com"
              className={inputClass}
            />
          )}
          {tab === 'screenshot' && (
            <input
              name="screenshot"
              type="file"
              required
              accept="image/png,image/jpeg,image/webp,image/gif"
              className={inputClass}
            />
          )}
          <textarea
            name="notes"
            rows={2}
            maxLength={2000}
            placeholder="Optional: what should the app do?"
            className={inputClass}
          />
          <label className="flex items-center gap-2 font-display text-sm text-text-dim">
            <input type="checkbox" name="planMode" value="true" /> Plan first
          </label>
          {error && (
            <p role="alert" className="font-display text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="h-[45px] self-start rounded-full bg-appweaver-orange px-6 font-display text-white disabled:opacity-60">
            {pending ? 'Importing…' : 'Import and build'}
          </button>
        </form>
      )}
    </div>
  );
}
