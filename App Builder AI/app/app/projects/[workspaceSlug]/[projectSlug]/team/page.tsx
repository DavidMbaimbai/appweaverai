import { notFound } from 'next/navigation';

import { DevTeamPanel } from '@/components/app/dev-team/dev-team-panel';
import { getCachedSession } from '@/lib/auth/cached';
import { isProjectOwner } from '@/lib/code-scan/service';
import { loadTeamPage } from '@/lib/dev-team/view';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

export const dynamic = 'force-dynamic';
// Runs execute after the response (next/server after()), so give them the full window.
export const maxDuration = 300;

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectTeamPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true, workspaceId: true },
  });
  if (!project) notFound();

  const [data, isOwner] = await Promise.all([
    loadTeamPage({ projectId: project.id, userId, workspaceId: project.workspaceId }),
    isProjectOwner(project.id, userId),
  ]);

  return <DevTeamPanel projectId={project.id} projectName={project.name} isOwner={isOwner} data={data} />;
}
