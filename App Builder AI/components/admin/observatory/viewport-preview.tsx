'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

const VIEWPORTS = {
  desktop: { label: 'Desktop', width: '100%' },
  tablet: { label: 'Tablet', width: '768px' },
  mobile: { label: 'Mobile', width: '390px' },
} as const;

type Viewport = keyof typeof VIEWPORTS;

/**
 * Isolated preview of a customer app. The frame is sandboxed WITHOUT
 * allow-same-origin, so customer code cannot reach the admin session,
 * and URLs never carry tokens.
 */
export function ViewportPreview({
  productionUrl,
  developmentUrl,
}: {
  productionUrl: string | null;
  developmentUrl: string | null;
}) {
  const [mode, setMode] = useState<'production' | 'development'>(productionUrl ? 'production' : 'development');
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const src = mode === 'production' ? productionUrl : developmentUrl;

  const pill = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1 text-xs',
      active ? 'bg-app-surface-active text-app-text' : 'text-app-text-muted hover:bg-app-surface-hover',
    );

  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-sm font-medium text-app-text">Live preview</h2>
        <button type="button" className={pill(mode === 'production')} disabled={!productionUrl} onClick={() => setMode('production')}>
          Production
        </button>
        <button type="button" className={pill(mode === 'development')} disabled={!developmentUrl} onClick={() => setMode('development')}>
          Development
        </button>
        <span className="mx-1 h-4 w-px bg-app-border-subtle" />
        {(Object.keys(VIEWPORTS) as Viewport[]).map((key) => (
          <button key={key} type="button" className={pill(viewport === key)} onClick={() => setViewport(key)}>
            {VIEWPORTS[key].label}
          </button>
        ))}
        <span
          className={cn(
            'ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium',
            mode === 'production' ? 'bg-emerald-950/50 text-emerald-400' : 'bg-amber-950/50 text-amber-400',
          )}>
          {mode === 'production' ? 'PRODUCTION (published)' : 'DEVELOPMENT (unpublished workspace)'}
        </span>
      </div>
      {src ? (
        <div className="flex justify-center overflow-auto rounded-lg bg-app-bg p-2">
          <iframe
            key={`${mode}-${viewport}`}
            title="App preview"
            src={src}
            sandbox="allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
            style={{ width: VIEWPORTS[viewport].width, maxWidth: '100%' }}
            className="h-[640px] rounded-md border border-app-border-subtle bg-white"
          />
        </div>
      ) : (
        <p className="text-sm text-app-text-muted">Nothing to preview yet.</p>
      )}
      {mode === 'development' ? (
        <p className="mt-2 text-xs text-app-text-muted">
          Private workspace previews load assets without the admin session, so some files may not render.
        </p>
      ) : null}
    </div>
  );
}
