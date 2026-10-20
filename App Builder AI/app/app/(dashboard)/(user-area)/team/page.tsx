import { notFound } from 'next/navigation';

import { NotificationBell } from '@/components/app/team/notification-bell';
import { TeamPanel } from '@/components/app/team/team-panel';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { resolveWorkspaceRole } from '@/lib/team/access';
import { listInvitations } from '@/lib/team/invitations';
import { listMembers } from '@/lib/team/members';
import { can } from '@/lib/team/permissions';
import { getSeatUsage } from '@/lib/team/seats';
import { getWorkspaceUsage } from '@/lib/team/spend';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const workspaces = await prisma.workspace.findMany({
    where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
    select: { id: true, name: true, slug: true, ownerId: true },
    orderBy: { createdAt: 'asc' },
  });

  const sections = await Promise.all(
    workspaces.map(async (w) => {
      const ctx = await resolveWorkspaceRole(userId, w.id);
      const role = ctx?.role ?? 'VIEWER';
      const manage = can(role, 'manage_members');
      const [members, invitations, seats, usage] = await Promise.all([
        listMembers(userId, { workspaceId: w.id }),
        manage ? listInvitations(userId, { workspaceId: w.id }) : [],
        manage ? getSeatUsage(w.id) : null,
        can(role, 'view_billing') ? getWorkspaceUsage(userId, w.id) : null,
      ]);
      return {
        workspace: { id: w.id, name: w.name, slug: w.slug },
        role,
        isOwner: w.ownerId === userId,
        members,
        invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() })),
        seats: seats ? { used: seats.used, pending: seats.pending, limit: seats.limit } : null,
        usage: usage && usage.ok ? usage.rows : null,
      };
    }),
  );

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-app-text">Team</h1>
        <NotificationBell />
      </div>
      {sections.map((s) => (
        <TeamPanel key={s.workspace.id} {...s} />
      ))}
    </main>
  );
}
