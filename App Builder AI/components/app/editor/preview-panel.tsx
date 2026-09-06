'use client';

import { useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { deleteArtifactAction } from '@/lib/actions/artifacts';
import {
  artifactHasPreviewContent,
  MAX_ARTIFACTS_PER_PROJECT,
  MIN_ARTIFACTS_PER_PROJECT,
} from '@/lib/artifact-types';
import {
  isAgentWorkingOnArtifact,
  type AgentActivity,
} from '@/lib/agent/agent-activity';
import { artifactTypeLabels, artifactTypeToCategoryId } from '@/lib/app-types';
import type { AppProjectDetail } from '@/lib/app-types';
import type {
  ArtifactStatus,
  ArtifactType,
} from '@/lib/generated/prisma/client';
import { cn } from '@/lib/utils';

import { AddArtifactDialog } from './add-artifact-dialog';
import {
  AgentActivityPulse,
  AgentWorkingBadge,
} from './agent-activity-indicator';
import { ArtifactPreview } from './artifact-preview';
import { CategoryIcon } from '@/components/shared/category-icons';

type PreviewPanelProps = {
  project: AppProjectDetail;
  activeArtifactId: string | null;
  previewVersion: number;
  agentActivity: AgentActivity;
  onArtifactChange: (artifactId: string) => void;
  onArtifactCreated: (artifact: {
    id: string;
    type: ArtifactType;
    name: string;
    slug: string;
    status: ArtifactStatus;
  }) => void;
  onArtifactDeleted: (artifact: { id: string; slug: string }) => void;
  onError?: (message: string) => void;
};

export function PreviewPanel({
  project,
  activeArtifactId,
  previewVersion,
  agentActivity,
  onArtifactChange,
  onArtifactCreated,
  onArtifactDeleted,
  onError,
}: PreviewPanelProps) {
  const { success } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    AppProjectDetail['artifacts'][number] | null
  >(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const atLimit = project.artifacts.length >= MAX_ARTIFACTS_PER_PROJECT;
  const canDelete = project.artifacts.length > MIN_ARTIFACTS_PER_PROJECT;
  const activeArtifact =
    project.artifacts.find((artifact) => artifact.id === activeArtifactId) ??
    project.artifacts[0] ??
    null;

  const hasFiles = useMemo(() => {
    if (!activeArtifact) return false;
    return artifactHasPreviewContent(
      activeArtifact,
      project.files,
      project.messages,
    );
  }, [activeArtifact, project.files, project.messages]);

  function handleConfirmDelete() {
    if (!deleteTarget) return;

    startDeleteTransition(async () => {
      const result = await deleteArtifactAction(project.id, deleteTarget.id);

      if (result.error) {
        onError?.(result.error);
        return;
      }

      if (result.artifact) {
        onArtifactDeleted(result.artifact);
        success(`Deleted ${result.artifact.name}`);
        setDeleteTarget(null);
      }
    });
  }

  return (
    <section className="relative flex h-full min-w-0 flex-[1.35] flex-col bg-app-bg">
      <AddArtifactDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        projectId={project.id}
        currentCount={project.artifacts.length}
        onCreated={onArtifactCreated}
        onError={onError}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete artifact?"
        description="This will permanently remove this artifact and all of its files from the project."
        itemName={deleteTarget?.name}
        confirmLabel="Delete artifact"
        variant="destructive"
        isPending={isDeleting}
      />

      <div className="flex items-center gap-2 overflow-x-auto border-b border-app-border-subtle bg-app-sidebar-bg/50 px-4 py-2">
        {project.artifacts.map((artifact) => {
          const icon = artifactTypeToCategoryId[artifact.type];
          const isActive = activeArtifact?.id === artifact.id;
          const isWorking = isAgentWorkingOnArtifact(
            agentActivity,
            artifact.id,
          );

          return (
            <div
              key={artifact.id}
              className={cn(
                'group inline-flex shrink-0 items-center rounded-lg transition-colors',
                isActive
                  ? 'bg-app-surface-active text-app-text'
                  : 'text-app-text-muted hover:bg-app-surface-hover hover:text-app-text-secondary',
                isWorking && 'ring-1 ring-replit-orange/40',
              )}>
              <button
                type="button"
                onClick={() => onArtifactChange(artifact.id)}
                className={cn(
                  'inline-flex items-center gap-2 py-1.5 pl-3 text-sm transition-colors',
                  canDelete ? 'pr-1' : 'pr-3',
                )}>
                {isWorking ? (
                  <AgentActivityPulse
                    label={`Agent working on ${artifact.name}`}
                  />
                ) : null}
                {icon ? <CategoryIcon icon={icon} /> : null}
                {artifact.name}
              </button>
              {canDelete ? (
                <button
                  type="button"
                  aria-label={`Delete ${artifact.name}`}
                  onClick={() => setDeleteTarget(artifact)}
                  className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-app-text-muted opacity-0 transition-all hover:bg-black/10 hover:text-app-text group-hover:opacity-100">
                  <CloseIcon />
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => {
            if (atLimit) {
              onError?.(
                `Projects can have up to ${MAX_ARTIFACTS_PER_PROJECT} artifacts.`,
              );
              return;
            }
            setAddDialogOpen(true);
          }}
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed transition-colors',
            atLimit
              ? 'cursor-not-allowed border-app-border/60 text-app-text-muted/50'
              : 'border-app-border text-app-text-muted hover:border-replit-orange/50 hover:text-replit-orange',
          )}
          aria-label="Add artifact">
          +
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-app-border-subtle px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="muted" theme="app">
              Preview
            </Badge>
            {activeArtifact ? (
              <span className="text-sm text-app-text-muted">
                {artifactTypeLabels[activeArtifact.type]}
              </span>
            ) : null}
            {activeArtifact &&
            isAgentWorkingOnArtifact(agentActivity, activeArtifact.id) ? (
              <AgentWorkingBadge
                label={agentActivity.activeAction ?? 'Working…'}
                className="max-w-[220px]"
              />
            ) : null}
          </div>
        </div>

        {activeArtifact ? (
          <ArtifactPreview
            projectId={project.id}
            artifact={activeArtifact}
            previewVersion={previewVersion}
            hasFiles={hasFiles}
            agentActivity={agentActivity}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-app-text-muted">
              No artifacts in this project yet.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
