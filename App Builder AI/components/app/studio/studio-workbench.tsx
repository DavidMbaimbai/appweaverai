'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { runStudioAction, type StudioResult } from '@/lib/actions/studio';
import {
  MAX_BRIEF_LENGTH,
  STUDIO_IMAGE_TOOL,
  STUDIO_TOOLS,
} from '@/lib/studio/tools';
import { cn } from '@/lib/utils';

const TOOLS = [...STUDIO_TOOLS, STUDIO_IMAGE_TOOL];

export type StudioCredits = {
  metered: boolean;
  balance: number;
  textCost: number;
  imageCost: number;
  marketingBalance: number;
  launchKitCost: number;
};

export function StudioWorkbench({ credits }: { credits?: StudioCredits }) {
  const [toolId, setToolId] = useState<string>(TOOLS[0].id);
  const [brief, setBrief] = useState('');
  const [result, setResult] = useState<StudioResult | null>(null);
  const [pending, startTransition] = useTransition();
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0];
  const cost = credits?.metered ? (toolId === 'image' ? credits.imageCost : credits.textCost) : 0;

  function run() {
    setResult(null);
    startTransition(async () => {
      setResult(await runStudioAction(toolId, brief));
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <nav className="flex flex-row flex-wrap gap-2 md:flex-col">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setToolId(t.id);
              setResult(null);
            }}
            className={cn(
              'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              t.id === toolId
                ? 'border-app-text bg-app-surface font-medium text-app-text'
                : 'border-app-border-subtle text-app-text-secondary hover:bg-app-surface',
            )}>
            <span className="block text-[11px] uppercase tracking-wide text-app-text-muted">{t.group}</span>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="space-y-4">
        <label className="block text-sm font-medium text-app-text" htmlFor="studio-brief">
          {tool.label}
          <span className="ml-2 font-normal text-app-text-muted">{tool.hint}</span>
        </label>
        <textarea
          id="studio-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={MAX_BRIEF_LENGTH}
          rows={5}
          className="w-full rounded-xl border border-app-border-subtle bg-app-surface p-3 text-sm text-app-text"
          placeholder="e.g. A booking app for independent hair salons in London, aimed at owners with 1 to 3 chairs."
        />
        <button
          type="button"
          onClick={run}
          disabled={pending || brief.trim().length < 10}
          className="rounded-lg bg-app-text px-4 py-2 text-sm font-medium text-app-bg disabled:opacity-50">
          {pending
            ? 'Working…'
            : toolId === 'image' && credits
              ? `Generate · ${credits.imageCost} marketing credits`
              : cost
                ? `Generate · ${cost} credits`
                : 'Generate'}
        </button>
        {toolId === 'image' && credits ? (
          <p className="text-xs text-app-text-muted">
            Marketing credit balance: {credits.marketingBalance}.{' '}
            <Link href="/app/marketing-credits" className="underline">Top up</Link>
          </p>
        ) : credits?.metered ? (
          <p className="text-xs text-app-text-muted">
            Balance: {credits.balance} credits.{' '}
            <Link href="/app/usage" className="underline">Usage &amp; credits</Link>
          </p>
        ) : null}

        {result && !result.ok ? <p className="text-sm text-red-500">{result.error}</p> : null}
        {result?.ok && result.kind === 'text' ? (
          <div className="whitespace-pre-wrap rounded-xl border border-app-border-subtle bg-app-surface p-4 text-sm text-app-text">
            {result.text}
          </div>
        ) : null}
        {result?.ok && result.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${result.imageBase64}`}
            alt="Generated design"
            className="w-full max-w-md rounded-xl border border-app-border-subtle"
          />
        ) : null}
      </div>
    </div>
  );
}
