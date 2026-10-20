import { notFound } from 'next/navigation';

import { MobileDeliveryView } from '@/components/app/mobile/mobile-delivery';
import { getCachedSession } from '@/lib/auth/cached';
import { loadMobileDashboard } from '@/lib/mobile/service';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';
import { resolveProjectRole } from '@/lib/team/access';
import { can } from '@/lib/team/permissions';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectMobilePage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const [data, role] = await Promise.all([
    loadMobileDashboard(project.id, project.name, projectSlug),
    resolveProjectRole(userId, project.id),
  ]);

  return (
    <MobileDeliveryView
      projectId={project.id}
      projectName={project.name}
      builderHref={`/app/projects/${workspaceSlug}/${projectSlug}`}
      canBuild={Boolean(role && can(role.role, 'publish'))}
      canManageCredentials={Boolean(role && can(role.role, 'manage_integrations'))}
      data={data}
    />
  );
}
