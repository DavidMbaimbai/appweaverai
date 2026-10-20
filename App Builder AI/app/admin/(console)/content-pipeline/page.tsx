import { ContentPipelinePanel } from '@/components/app/content-pipeline/content-pipeline-panel';
import { AdminPageHeader } from '@/components/admin/ui/primitives';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { PLATFORM_SCOPE_PLATFORMS } from '@/lib/content-pipeline/types';
import { loadPipelineView } from '@/lib/content-pipeline/view';

export const dynamic = 'force-dynamic';

export default async function AdminContentPipelinePage() {
  const auth = await requireAdmin('contentpipeline:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'contentpipeline:write');
  const view = await loadPipelineView({ type: 'PLATFORM' });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Content pipeline"
        description="Daily AppWeaver house content. Internal cost: no customer credits are charged. Enable the Content and Marketing Director agents in Command Centre first."
      />
      {canWrite ? (
        <ContentPipelinePanel
          initial={view.initial}
          platformOptions={[...PLATFORM_SCOPE_PLATFORMS]}
          runs={view.runs}
          estimateCredits={null}
          exists={view.exists}
        />
      ) : (
        <p className="text-sm text-app-text-muted">Read-only. {view.runs.length} recent runs.</p>
      )}
    </div>
  );
}
