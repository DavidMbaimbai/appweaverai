'use client';

import { ReasonActionButton } from '@/components/admin/users/reason-action-button';
import {
  archiveProjectAction,
  restoreProjectAction,
  suspendProjectAction,
} from '@/lib/admin/actions/projects';
import type { ProjectAdminStatus } from '@/lib/generated/prisma/client';

export function ProjectActionsPanel({
  projectId,
  adminStatus,
  canWrite,
}: {
  projectId: string;
  adminStatus: ProjectAdminStatus;
  canWrite: boolean;
}) {
  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-app-text">
        Project actions
      </h2>

      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {adminStatus !== 'ACTIVE' ? (
            <ReasonActionButton
              label="Restore"
              title="Restore project"
              description="Restore this project to ACTIVE status and clear any admin suspension/archive markers."
              confirmLabel="Restore project"
              variant="primary"
              onSubmit={(reason) => restoreProjectAction(projectId, reason)}
            />
          ) : null}

          {adminStatus === 'ACTIVE' ? (
            <ReasonActionButton
              label="Suspend"
              title="Suspend project"
              description="Suspended projects are marked for admin review and can be restored later."
              confirmLabel="Suspend project"
              onSubmit={(reason) => suspendProjectAction(projectId, reason)}
            />
          ) : null}

          {adminStatus !== 'ARCHIVED' ? (
            <ReasonActionButton
              label="Archive"
              title="Archive project"
              description="Archiving marks the project as no longer active for normal operations while preserving its record."
              confirmLabel="Archive project"
              onSubmit={(reason) => archiveProjectAction(projectId, reason)}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-app-text-muted">
          You do not have permission to change project status.
        </p>
      )}
    </div>
  );
}
