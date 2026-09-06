'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isAgentWorkingOnArtifact,
  type AgentActivity,
} from '@/lib/agent/agent-activity';
import { getArtifactEmptyStateMessage } from '@/lib/artifact-types';
import { artifactTypeLabels, type AppProjectDetail } from '@/lib/app-types';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';
import { AgentActivityPulse } from './agent-activity-indicator';
import {
  getPreviewDevicePreset,
  isDeviceFramedPreview,
  isPreviewDeviceId,
  previewDeviceStorageKey,
  type PreviewDeviceId,
} from '@/lib/preview/preview-device-sizes';
import { hideDevicePreviewScrollbars } from '@/lib/preview/hide-device-preview-scrollbars';
import { PreviewDeviceMenu } from './preview-device-menu';

type ArtifactPreviewProps = {
  projectId: string;
  artifact: AppProjectDetail['artifacts'][number];
  previewVersion: number;
  hasFiles: boolean;
  agentActivity?: AgentActivity;
  className?: string;
};

const PREVIEW_CANVAS_PADDING = 32;

function readStoredDeviceId(projectId: string): PreviewDeviceId {
  if (typeof window === 'undefined') return 'full';
  try {
    const stored = window.localStorage.getItem(
      previewDeviceStorageKey(projectId),
    );
    if (stored && isPreviewDeviceId(stored)) return stored;
  } catch {}
  return 'full';
}

export function ArtifactPreview({
  projectId,
  artifact,
  previewVersion,
  hasFiles,
  agentActivity,
  className,
}: ArtifactPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isBuilding, setIsBuilding] = useState(false);
  const [deviceId, setDeviceId] = useState<PreviewDeviceId>('full');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const device = useMemo(() => getPreviewDevicePreset(deviceId), [deviceId]);
  const isFullSize = device.width === null || device.height === null;
  const isFramedDevice = isDeviceFramedPreview(deviceId);

  const previewPath = useMemo(() => {
    const versionQuery = previewVersion > 0 ? `?v=${previewVersion}` : '';
    return `/api/projects/${projectId}/preview/${artifact.slug}${versionQuery}`;
  }, [artifact.slug, previewVersion, projectId]);

  const frameScale = useMemo(() => {
    if (isFullSize || canvasSize.width === 0 || canvasSize.height === 0)
      return 1;

    const availableWidth = canvasSize.width - PREVIEW_CANVAS_PADDING * 2;
    const availableHeight = canvasSize.height - PREVIEW_CANVAS_PADDING * 2;

    return Math.min(
      1,
      availableWidth / device.width!,
      availableHeight / device.height!,
    );
  }, [
    canvasSize.height,
    canvasSize.width,
    device.height,
    device.width,
    isFullSize,
  ]);

  const isAgentWorking = agentActivity
    ? isAgentWorkingOnArtifact(agentActivity, artifact.id)
    : false;

  useEffect(() => {
    setTimeout(() => {
      setDeviceId(readStoredDeviceId(projectId));
    }, 0);
  }, [projectId]);

  useEffect(() => {
    setTimeout(() => {
      setRefreshKey((value) => value + 1);
      setIsBuilding(true);
    }, 0);

    const timer = window.setTimeout(() => setIsBuilding(false), 900);
    return () => window.clearTimeout(timer);
  }, [previewVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      setCanvasSize({
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasFiles]);

  const notifyIframeResize = useCallback(() => {
    const iframe = iframeRef.current;
    const iframeWindow = iframe?.contentWindow;
    if (!iframeWindow) return;

    if (device.hideScrollbars) {
      hideDevicePreviewScrollbars(iframe);
    }

    try {
      iframeWindow.dispatchEvent(new Event('resize'));
    } catch {
      // Cross-origin or sandboxed iframe — ignore.
    }
  }, [device.hideScrollbars]);

  useEffect(() => {
    if (!hasFiles) return;

    const timer = window.setTimeout(notifyIframeResize, 380);
    return () => window.clearTimeout(timer);
  }, [deviceId, frameScale, hasFiles, notifyIframeResize]);

  useEffect(() => {
    if (!hasFiles || !device.hideScrollbars) return;

    const timer = window.setTimeout(() => {
      hideDevicePreviewScrollbars(iframeRef.current);
    }, 480);
    return () => window.clearTimeout(timer);
  }, [device.hideScrollbars, deviceId, hasFiles, refreshKey]);

  function handleDeviceChange(nextDeviceId: PreviewDeviceId) {
    setDeviceId(nextDeviceId);

    try {
      window.localStorage.setItem(
        previewDeviceStorageKey(projectId),
        nextDeviceId,
      );
    } catch {
      // Ignore storage errors.
    }
  }

  function handleRefresh() {
    setRefreshKey((value) => value + 1);
  }

  if (!hasFiles) {
    const emptyState = getArtifactEmptyStateMessage(artifact.type);

    return (
      <div
        className={cn(
          'relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(255,60,0,0.06),transparent_60%),linear-gradient(180deg,var(--app-surface)_0%,var(--app-bg)_100%)] p-8',
          className,
        )}>
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(var(--app-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--app-border-subtle) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
          aria-hidden="true"
        />
        <div className="relative max-w-md text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-app-text-muted">
            {artifactTypeLabels[artifact.type]}
          </p>
          <h3 className="mt-2 font-display text-2xl text-app-text">
            {artifact.name}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-app-text-muted">
            {emptyState.description}
          </p>
          <p className="mt-3 rounded-lg border border-app-border-subtle bg-app-surface/60 px-4 py-3 text-sm leading-relaxed text-app-text-secondary">
            {emptyState.hint}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex items-center gap-2 border-b border-app-border-subtle px-4 py-2">
        <span className="text-xs font-medium text-app-text-muted">Canbas</span>
        <span className="text-sm text-app-text">{artifact.name}</span>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          <div className="hidden min-w-0 flex-1 items-center rounded-lg border border-app-border bg-app-surface px-3 py-1.5 tablet-up:flex">
            <span className="truncate text-xs text-app-text-muted">
              {artifact.slug}.replit.dev
            </span>
          </div>
          <PreviewDeviceMenu value={deviceId} onChange={handleDeviceChange} />
          <IconButton
            label="Refresh preview"
            size="sm"
            theme="app"
            onClick={handleRefresh}>
            <RefreshIcon />
          </IconButton>
          <a
            href={previewPath}
            target="_blank"
            rel="noreferrer"
            aria-label="Open preview in new tab"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text-secondary">
            <OpenIcon />
          </a>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[#0a0a0a]">
        <div
          className={cn(
            'flex h-full w-full',
            isFullSize
              ? 'items-stretch justify-stretch'
              : 'items-center justify-center p-8',
          )}>
          <div
            className={cn(
              'relative shrink-0 overflow-hidden bg-black shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition-[width,height,transform,border-radius] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
              isFullSize
                ? 'h-full w-full rounded-none border-0'
                : 'border border-white/10',
            )}
            style={
              isFullSize
                ? undefined
                : {
                    width: device.width!,
                    height: device.height!,
                    borderRadius: device.radius,
                    transform: `scale(${frameScale})`,
                    transformOrigin: 'center center',
                    isolation: 'isolate',
                  }
            }>
            <div
              className={cn(
                'h-full w-full overflow-hidden bg-black',
                isFramedDevice && 'device-preview-screen',
              )}
              style={
                isFramedDevice
                  ? {
                      borderRadius: device.radius,
                    }
                  : undefined
              }>
              <iframe
                ref={iframeRef}
                key={refreshKey}
                title={`${artifact.name} preview`}
                src={previewPath}
                sandbox="allow-scripts allow-same-origin allow-forms"
                className={cn(
                  'block h-full w-full border-0 bg-black',
                  isFramedDevice && 'device-preview-iframe',
                )}
                style={
                  isFramedDevice
                    ? {
                        borderRadius: device.radius,
                      }
                    : undefined
                }
                onLoad={() => {
                  setIsBuilding(false);
                  notifyIframeResize();
                }}
              />
            </div>
          </div>
        </div>

        {isBuilding || isAgentWorking ? (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-black/20 pt-6">
            <span className="inline-flex max-w-[min(90%,320px)] items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/80">
              {isAgentWorking ? (
                <>
                  <AgentActivityPulse
                    label={agentActivity?.activeAction ?? 'Agent working'}
                  />
                  <span className="truncate">
                    {agentActivity?.activeAction ?? 'Agent working…'}
                  </span>
                </>
              ) : (
                'Building preview…'
              )}
            </span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2">
          {!isFullSize ? (
            <span className="rounded-md bg-black/70 px-2 py-1 text-[10px] text-white/70">
              {device.label}
              {frameScale < 1 ? ` · ${Math.round(frameScale * 100)}%` : ''}
            </span>
          ) : null}
          <span className="rounded-md bg-black/70 px-2 py-1 text-[10px] text-white/70">
            {artifactTypeLabels[artifact.type]}
          </span>
        </div>
      </div>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M14 5h5v5M10 14 19 5M19 14v5H5V5h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
