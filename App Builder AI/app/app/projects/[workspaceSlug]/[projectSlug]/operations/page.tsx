import { notFound } from 'next/navigation';

import { OperationsHub } from '@/components/app/ops/operations-hub';
import { getCachedSession } from '@/lib/auth/cached';
import { appOrigin } from '@/lib/observatory/smoke';
import { getOperationsData, getOpsAccess } from '@/lib/ops/service';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectOperationsPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const [access, data, githubAccount] = await Promise.all([
    getOpsAccess(project.id, userId),
    getOperationsData(project.id, appOrigin()),
    prisma.userGithubConnection.findUnique({
      where: { userId },
      select: { githubUsername: true },
    }),
  ]);

  return (
    <OperationsHub
      projectId={project.id}
      projectName={project.name}
      builderHref={`/app/projects/${workspaceSlug}/${projectSlug}`}
      isOwner={access.owner}
      githubAccount={githubAccount?.githubUsername ?? null}
      data={data}
      generatedAt={new Date().toISOString()}
    />
  );
}
