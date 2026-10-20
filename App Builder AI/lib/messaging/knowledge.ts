import type { AgentScope } from '@/lib/agents/types';
import { prisma } from '@/lib/prisma';
import type { KnowledgeDoc } from '@/lib/project-reviews/retrieval';

/**
 * Knowledge a scope may answer from. A project sees only its own ProjectKnowledge; the platform sees only
 * PlatformKnowledge. There is intentionally no code path that combines the two.
 */
export async function loadKnowledge(scope: AgentScope): Promise<KnowledgeDoc[]> {
  if (scope.type === 'PLATFORM') {
    const rows = await prisma.platformKnowledge.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: r.id, title: r.title, content: r.content }));
  }
  const rows = await prisma.projectKnowledge.findMany({
    where: { projectId: scope.projectId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({ id: r.id, title: r.title, content: r.content }));
}
