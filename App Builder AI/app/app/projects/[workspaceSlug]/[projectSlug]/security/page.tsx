import { notFound } from 'next/navigation';

import { SecurityScanPanel } from '@/components/app/code-scan/security-scan-panel';
import { getCachedSession } from '@/lib/auth/cached';
import { getLatestScan, isProjectOwner } from '@/lib/code-scan/service';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectSecurityPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const [scan, isOwner] = await Promise.all([getLatestScan(project.id), isProjectOwner(project.id, userId)]);

  return (
    <SecurityScanPanel
      projectId={project.id}
      projectName={project.name}
      builderHref={`/app/projects/${workspaceSlug}/${projectSlug}`}
      isOwner={isOwner}
      initialScan={scan}
    />
  );
}
