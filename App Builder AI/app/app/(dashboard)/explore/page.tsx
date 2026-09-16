import { PageHeader } from '@/components/app/shell/page-header';
import {
  listExploreCategories,
  listPublicProjects,
  type ExploreSort,
} from '@/lib/queries/explore';
import { EmptyState } from '@/components/ui/empty-state';
import { RemixButton } from '@/components/app/published/remix-button';
import { GalleryFilters } from '@/components/app/explore/gallery-filters';

function formatCount(count: number) {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; category?: string }>;
}) {
  const params = await searchParams;
  const sort: ExploreSort =
    params.sort === 'popular' || params.sort === 'remixed'
      ? params.sort
      : 'recent';

  const [projects, categories] = await Promise.all([
    listPublicProjects({
      limit: 30,
      search: params.q,
      sort,
      category: params.category,
    }),
    listExploreCategories(),
  ]);

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Explore" />

      <div className="mx-auto w-full max-w-app-content flex-1 px-4 py-6 tablet-up:px-8">
        <p className="mb-6 text-sm text-app-text-muted">
          Browse apps the community has published publicly — search, sort by
          trending, and remix any of them to start your own version instantly.
        </p>

        <GalleryFilters categories={categories} />

        {projects.length === 0 ? (
          <EmptyState
            theme="app"
            title={
              params.q || params.category
                ? 'No matching apps'
                : 'Nothing published yet'
            }
            description={
              params.q || params.category
                ? 'Try a different search term or clear the filters.'
                : "Once projects are published publicly, they'll show up here for anyone to browse and remix."
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 tablet-up:grid-cols-2 desktop-up:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.projectId}
                className="group flex flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface transition-shadow hover:shadow-lg">
                <a
                  href={`/p/${project.workspaceSlug}/${project.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block aspect-video bg-app-surface-active">
                  {project.previewImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={project.previewImageUrl}
                      alt={project.name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-app-text-muted">
                      No preview available
                    </div>
                  )}
                  {project.category && (
                    <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium capitalize text-white">
                      {project.category.toLowerCase().replace(/_/g, ' ')}
                    </span>
                  )}
                </a>
                <div className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
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

                  <div className="flex items-center justify-between gap-2 text-xs text-app-text-muted">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {project.authorImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={project.authorImage}
                          alt=""
                          className="h-4 w-4 shrink-0 rounded-full"
                        />
                      ) : null}
                      <span className="truncate">
                        {project.authorName ?? 'Anonymous'}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span title={`${project.viewCount} views`}>
                        👁 {formatCount(project.viewCount)}
                      </span>
                      <span title={`${project.remixCount} remixes`}>
                        🔀 {formatCount(project.remixCount)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
