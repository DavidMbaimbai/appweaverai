'use client';

import { IconButton } from '@/components/ui/icon-button';
import {
  artifactSlugFromAgentPath,
  isAgentWorkingOnFile,
} from '@/lib/agent/agent-activity';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentActivity } from '@/lib/agent/agent-activity';
import type { AppProjectDetail } from '@/lib/app-types';
import { cn } from '@/lib/utils';
import { AgentActivityPulse } from './agent-activity-indicator';

type ProjectFileEntry = {
  path: string;
  sizeBytes: number;
  mimeType: string | null;
  updatedAt: string;
  artifactId: string | null;
};

type LibraryProjectFilesProps = {
  project: AppProjectDetail;
  previewVersion: number;
  agentActivity: AgentActivity;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameFromPath(path: string) {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

function artifactSlugFromPath(path: string) {
  return path.split('/')[0] ?? 'main';
}

export function LibraryProjectFiles({
  project,
  previewVersion,
  agentActivity,
}: LibraryProjectFilesProps) {
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/files`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Could not load project files.');
      }

      const data = (await response.json()) as { files: ProjectFileEntry[] };
      setFiles(data.files);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to load files.',
      );
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    setTimeout(() => {
      void fetchFiles();
    }, 10);
  }, [previewVersion, fetchFiles]);

  const groupedFiles = useMemo(() => {
    const groups = new Map<string, ProjectFileEntry[]>();

    for (const file of files) {
      const slug = artifactSlugFromPath(file.path);
      const relativePath = file.path.slice(slug.length + 1);
      if (!relativePath || slug === file.path) continue;

      const existing = groups.get(slug) ?? [];
      existing.push({ ...file, path: relativePath });
      groups.set(slug, existing);
    }

    if (agentActivity.isWorking && agentActivity.activeFilePath) {
      const slug = artifactSlugFromAgentPath(agentActivity.activeFilePath);
      const relativePath = agentActivity.activeFilePath.slice(slug.length + 1);
      if (slug && relativePath) {
        const existing = groups.get(slug) ?? [];
        const alreadyListed = existing.some(
          (file) => file.path === relativePath,
        );
        if (!alreadyListed) {
          existing.unshift({
            path: relativePath,
            sizeBytes: 0,
            mimeType: null,
            updatedAt: new Date().toISOString(),
            artifactId: null,
          });
          groups.set(slug, existing);
        }
      }
    }

    return groups;
  }, [agentActivity.activeFilePath, agentActivity.isWorking, files]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          Files
        </h3>
        <IconButton
          label="Refresh files"
          size="sm"
          theme="app"
          onClick={() => void fetchFiles()}>
          <RefreshIcon />
        </IconButton>
      </div>

      <p className="mb-3 rounded-lg border border-app-border-subtle bg-app-surface/50 px-2.5 py-2 text-[11px] leading-relaxed text-app-text-muted">
        Download into one folder, then open{' '}
        <span className="font-mono text-app-text-secondary">index.html</span>{' '}
        locally.
      </p>

      {loading && files.length === 0 ? (
        <p className="text-xs text-app-text-muted">Loading files…</p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-replit-orange/30 bg-replit-orange/10 px-2.5 py-2 text-xs text-replit-orange">
          {error}
        </p>
      ) : null}

      {!loading && !error && groupedFiles.size === 0 ? (
        <p className="rounded-lg border border-dashed border-app-border bg-app-surface/50 px-3 py-4 text-xs leading-relaxed text-app-text-muted">
          Generated source files will appear here as Agent builds your project.
        </p>
      ) : null}

      <div className="space-y-4">
        {[...groupedFiles.entries()].map(([artifactSlug, artifactFiles]) => {
          const artifact = project.artifacts.find(
            (item) => item.slug === artifactSlug,
          );
          return (
            <div key={artifactSlug}>
              <h4 className="mb-1.5 truncate text-[10px] font-medium uppercase tracking-wide text-app-text-muted/80">
                {artifact?.name ?? artifactSlug}
              </h4>
              <ul className="space-y-1">
                {artifactFiles.map((file) => {
                  const downloadUrl = `/api/projects/${project.id}/preview/${artifactSlug}/${file.path}?download=1`;
                  const isWorking = isAgentWorkingOnFile(
                    agentActivity,
                    artifactSlug,
                    file.path,
                  );
                  return (
                    <li
                      key={`${artifactSlug}-${file.path}`}
                      className={cn(
                        'rounded-lg border bg-app-surface/70 px-2 py-2',
                        isWorking
                          ? 'border-replit-orange/40 ring-1 ring-replit-orange/20'
                          : 'border-app-border-subtle',
                      )}>
                      <div className="flex items-start gap-2">
                        {isWorking ? (
                          <AgentActivityPulse
                            className="mt-0.5"
                            label={`Agent writing ${fileNameFromPath(file.path)}`}
                          />
                        ) : (
                          <FileIcon className="mt-0.5 h-2.5 w-3.5 shrink-0 text-app-text-muted" />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[11px] text-app-text">
                            {fileNameFromPath(file.path)}
                          </p>
                          <p className="text-[10px] text-app-text-muted">
                            {isWorking
                              ? 'Writing…'
                              : file.sizeBytes > 0
                                ? formatBytes(file.sizeBytes)
                                : 'New file'}
                          </p>
                        </div>

                        {!isWorking ? (
                          <a
                            href={downloadUrl}
                            download={fileNameFromPath(file.path)}
                            aria-label={`Download ${fileNameFromPath(file.path)}`}
                            className={cn(
                              'shrink-0 rounded-md border border-app-border px-2 py-1 text-[10px] font-medium',
                              'text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text',
                            )}>
                            ↓
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="14"
      height="14"
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

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M8 4h6l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14 4v4h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
