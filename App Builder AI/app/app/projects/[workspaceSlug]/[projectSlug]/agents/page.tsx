import { notFound } from 'next/navigation';

import { AgentsPanel } from '@/components/app/agents/agents-panel';
import { listAgentSettings } from '@/lib/agents/settings';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectAgentsPage({ params }: Props) {
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

  const [settings, activities] = await Promise.all([
    listAgentSettings({ type: 'PROJECT', projectId: project.id }),
    prisma.agentActivity.findMany({
      where: { scopeType: 'PROJECT', scopeId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  return (
    <AgentsPanel
      projectId={project.id}
      projectName={project.name}
      builderHref={`/app/projects/${workspaceSlug}/${projectSlug}`}
      settings={settings.map((s) => ({ ...s, authorisedAt: s.authorisedAt?.toISOString() ?? null }))}
      activities={activities.map((a) => ({
        id: a.id,
        agent: a.agent,
        action: a.action,
        status: a.status,
        risk: a.risk,
        inputSummary: a.inputSummary,
        resultSummary: a.resultSummary,
        decisionReason: a.decisionReason,
        error: a.error,
        costCents: a.costCents,
        createdAt: a.createdAt.toISOString(),
      }))}
    />
  );
}
