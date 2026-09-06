type PublishedProjectViewerProps = {
  project: {
    id: string;
    name: string;
    slug: string;
    workspaceSlug: string;
    mainArtifact: { slug: string; name: string } | null;
    visibility: 'private' | 'workspace' | 'public';
    publishedUrl: string;
  };
};

export function PublishedProjectViewer({
  project,
}: PublishedProjectViewerProps) {
  const artifactSlug = project.mainArtifact?.slug ?? 'main';
  const previewUrl = `/api/projects/${project.id}/preview/${artifactSlug}`;

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-sm font-medium">{project.name}</p>
          <p className="text-xs text-white/60">
            {project.visibility === 'public'
              ? 'Public'
              : project.visibility === 'workspace'
                ? 'Workspace only'
                : 'Only you'}
          </p>
        </div>
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/10">
          Open full screen
        </a>
      </header>
      <iframe
        title={project.name}
        src={previewUrl}
        sandbox="allow-scripts allow-same-origin allow-forms"
        className="h-full w-full border-0"
      />
    </div>
  );
}
