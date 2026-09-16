import { PageHeader } from '@/components/app/shell/page-header';
import { listPublicProjects } from '@/lib/queries/explore';
import { EmptyState } from '@/components/ui/empty-state';
import { RemixButton } from '@/components/app/published/remix-button';

export default async function ExplorePage() {
  const projects = await listPublicProjects({ limit: 30 });

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Explore" />

      <div className="mx-auto w-full max-w-app-content flex-1 px-4 py-6 tablet-up:px-8">
        <p className="mb-6 text-sm text-app-text-muted">
          Browse projects the community has published publicly. Remix any of
          them to start your own version, instantly.
        </p>

        {projects.length === 0 ? (
          <EmptyState
            theme="app"
            title="Nothing published yet"
            description="Once projects are published publicly, they'll show up here for anyone to browse and remix."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 tablet-up:grid-cols-2 desktop-up:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.projectId}
                className="flex flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface">
                <a
                  href={`/p/${project.workspaceSlug}/${project.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-video bg-app-surface-active">
                  {project.previewImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={project.previewImageUrl}
                      alt={project.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-app-text-muted">
                      No preview available
                    </div>
                  )}
                </a>
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-app-text">
                      {project.name}
                    </p>
                    <a
                      href={`/p/${project.workspaceSlug}/${project.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-app-text-muted hover:underline">
                      View live →
                    </a>
                  </div>
                  <RemixButton projectId={project.projectId} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
