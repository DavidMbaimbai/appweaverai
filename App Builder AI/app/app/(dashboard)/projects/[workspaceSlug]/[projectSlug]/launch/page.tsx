import { notFound } from 'next/navigation';

import { LaunchChecklist } from '@/components/app/launch/launch-checklist';
import { PageHeader } from '@/components/app/shell/page-header';
import { getCachedSession } from '@/lib/auth/cached';
import { toStoredReport } from '@/lib/launch-readiness/service';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

export const dynamic = 'force-dynamic';

export default async function ProjectLaunchPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
}) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();
  const { workspaceSlug, projectSlug } = await params;

  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const latest = await prisma.launchReport.findFirst({
    where: { projectId: project.id, environment: 'PRODUCTION' },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <>
      <PageHeader title={`Launch readiness · ${project.name}`} />
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-6">
        <LaunchChecklist
          projectId={project.id}
          initialReport={latest ? toStoredReport(latest) : null}
        />
      </div>
    </>
  );
}
