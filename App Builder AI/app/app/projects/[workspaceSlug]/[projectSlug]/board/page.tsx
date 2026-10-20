import { notFound } from 'next/navigation';

import { NotificationBell } from '@/components/app/team/notification-bell';
import { TaskBoard } from '@/components/app/team/task-board';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { projectMemberAccessOr } from '@/lib/projects/access';
import { getBoard } from '@/lib/team/board';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectBoardPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, deletedAt: null, workspace: { slug: workspaceSlug }, OR: projectMemberAccessOr(userId) },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const result = await getBoard(userId, project.id);
  if (!result.ok) notFound();

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-app-text">Team board — {project.name}</h1>
          <p className="text-sm text-app-text-muted">Plan work with your team. Drag cards between columns, or use the Move menu on a card.</p>
        </div>
        <NotificationBell />
      </header>
      <TaskBoard projectId={project.id} initial={result.board} role={result.role} />
    </main>
  );
}
