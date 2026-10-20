import { notFound } from 'next/navigation';

import { QualityDashboardView } from '@/components/app/code-scan/quality-dashboard';
import { getCachedSession } from '@/lib/auth/cached';
import { loadQualityDashboard } from '@/lib/code-scan/dashboard';
import { isProjectOwner } from '@/lib/code-scan/service';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectQualityPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const [data, isOwner] = await Promise.all([loadQualityDashboard(project.id), isProjectOwner(project.id, userId)]);

  return (
    <QualityDashboardView
      projectId={project.id}
      projectName={project.name}
      builderHref={`/app/projects/${workspaceSlug}/${projectSlug}`}
      securityHref={`/app/projects/${workspaceSlug}/${projectSlug}/security`}
      isOwner={isOwner}
      data={data}
    />
  );
}
