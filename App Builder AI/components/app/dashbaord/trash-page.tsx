import { redirect } from 'next/navigation';
import { TrashPageClient } from '@/components/app/dashbaord/trash-page-client';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { getCachedSession } from '@/lib/auth/cached';
import { getTrashedProjectsForUser } from '@/lib/queries/projects';

export async function TrashPage() {
  const session = await getCachedSession();

  if (!session?.user?.id) {
    redirect('/?auth=login&callbackUrl=/app/trash');
  }

  const projects = process.env.DATABASE_URL
    ? await getTrashedProjectsForUser(session.user.id)
    : [];

  return (
    <div className="w-full px-6 py-8 tablet-up:px-8">
      <div className="mb-8">
        <h1 className="font-display text-2xl text-app-text">Trash</h1>
        <p className="mt-1 text-sm text-app-text-muted">
          Restore deleted projects or remove them permanently.
        </p>
      </div>

      {projects.length > 0 ? (
        <TrashPageClient projects={projects} />
      ) : (
        <EmptyState
          theme="app"
          className="w-full"
          title="Trash is empty"
          description="Deleted projects will appear here and can be restored."
          action={
            <Button
              href="/app/projects"
              variant="secondary"
              size="sm"
              theme="app">
              Back to projects
            </Button>
          }
        />
      )}
    </div>
  );
}
