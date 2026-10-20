import { notFound } from 'next/navigation';

import { ContentPipelinePanel } from '@/components/app/content-pipeline/content-pipeline-panel';
import { getCachedSession } from '@/lib/auth/cached';
import { CUSTOMER_SCOPE_PLATFORMS } from '@/lib/content-pipeline/types';
import { loadPipelineView } from '@/lib/content-pipeline/view';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectContentPipelinePage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      deletedAt: null,
      workspace: { slug: workspaceSlug },
      OR: [{ createdById: userId }, { workspace: { ownerId: userId } }],
    },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const view = await loadPipelineView({ type: 'PROJECT', projectId: project.id });

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <h1 className="text-xl font-semibold text-app-text">Daily content — {project.name}</h1>
        <p className="text-sm text-app-text-muted">Generates, validates and schedules fresh posts every day. Nothing is faked: videos are real jobs and finish on later ticks.</p>
      </header>
      <ContentPipelinePanel
        projectId={project.id}
        initial={view.initial}
        platformOptions={[...CUSTOMER_SCOPE_PLATFORMS]}
        runs={view.runs}
        estimateCredits={view.estimate}
        exists={view.exists}
      />
    </main>
  );
}
