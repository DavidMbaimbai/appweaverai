import { notFound } from 'next/navigation';

import { IntegrationsManager } from '@/components/app/integrations/integrations-manager';
import { getCachedSession } from '@/lib/auth/cached';
import { listConnections, listPublicCatalogue } from '@/lib/integrations/service';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere, projectOwnerAccessOr } from '@/lib/projects/access';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectIntegrationsPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const [catalogue, connections, owner] = await Promise.all([
    listPublicCatalogue(),
    listConnections(project.id),
    prisma.project.findFirst({ where: { id: project.id, OR: projectOwnerAccessOr(userId) }, select: { id: true } }),
  ]);

  return (
    <IntegrationsManager
      projectId={project.id}
      projectName={project.name}
      builderHref={`/app/projects/${workspaceSlug}/${projectSlug}`}
      isOwner={Boolean(owner)}
      catalogue={catalogue}
      initialConnections={connections}
    />
  );
}
