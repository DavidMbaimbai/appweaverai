import { notFound } from 'next/navigation';

import { MemoryPanel, type MemoryEntryView } from '@/components/app/memory/memory-panel';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { getMemoryAccess } from '@/lib/project-memory/access';
import { getLastInjection, listCodeMap, listMemories } from '@/lib/project-memory/store';
import { projectAccessWhere } from '@/lib/projects/access';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectMemoryPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true },
  });
  if (!project) notFound();
  const access = await getMemoryAccess(project.id, userId);
  if (!access) notFound();

  const [memories, codeMap, injection] = await Promise.all([
    listMemories(project.id, { status: 'ALL', take: 500 }),
    listCodeMap(project.id),
    getLastInjection(project.id),
  ]);

  const entries: MemoryEntryView[] = memories.map((m) => ({
    id: m.id,
    type: m.type,
    title: m.title,
    body: m.body,
    source: m.source,
    status: m.status,
    pinned: m.pinned,
    featureState: m.featureState,
    files: m.files,
    confidence: m.confidence,
    evidence: m.evidence ?? null,
    updatedAt: m.updatedAt.toISOString(),
  }));

  return (
    <MemoryPanel
      projectId={project.id}
      projectName={access.projectName}
      builderHref={`/app/projects/${workspaceSlug}/${projectSlug}`}
      canWrite={access.canWrite}
      entries={entries}
      codeMap={codeMap.map((c) => ({ path: c.path, purpose: c.purpose, exports: c.exports, routes: c.routes, dependencies: c.dependencies }))}
      lastInjection={
        injection
          ? {
              createdAt: injection.createdAt.toISOString(),
              request: injection.request,
              brief: injection.brief,
              tokenEstimate: injection.tokenEstimate,
              memoryTitles: entries.filter((e) => injection.memoryIds.includes(e.id)).map((e) => e.title),
              protectedFiles: injection.protectedFiles,
              unacknowledged: injection.unacknowledged,
            }
          : null
      }
    />
  );
}
