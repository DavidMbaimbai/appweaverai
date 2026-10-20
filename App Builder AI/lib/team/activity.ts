import { prisma } from '@/lib/prisma';
import { describeProjectActivityAction } from '@/lib/queries/project-activity';

import { requireProjectCapability } from './access';

export type FeedItem = {
  id: string;
  at: string;
  kind: 'task' | 'comment' | 'approval' | 'deployment' | 'member' | 'project';
  text: string;
  actor: string | null;
};

const TEAM_LABELS: Record<string, string> = {
  'task.created': 'created a task',
  'task.updated': 'updated a task',
  'task.assigned': 'assigned a task',
  'task.moved': 'moved a task',
  'task.deleted': 'deleted a task',
  'task.commented': 'commented on a task',
  'board.columns_changed': 'changed the board columns',
  'approval.requested': 'requested an approval',
  'approval.approved': 'approved a request',
  'approval.rejected': 'rejected a request',
  'approval.cancelled': 'cancelled an approval request',
  'team.invitation_sent': 'invited someone',
  'team.invitation_resent': 'resent an invitation',
  'team.invitation_revoked': 'revoked an invitation',
  'team.invitation_accepted': 'accepted an invitation',
  'team.member_role_changed': 'changed a member role',
  'team.member_removed': 'removed a member',
  'team.member_left': 'left the workspace',
  'team.ownership_transferred': 'transferred workspace ownership',
};

export function feedKindFor(action: string): FeedItem['kind'] {
  if (action === 'task.commented') return 'comment';
  if (action.startsWith('task.') || action.startsWith('board.')) return 'task';
  if (action.startsWith('approval.')) return 'approval';
  if (action.startsWith('team.')) return 'member';
  return 'project';
}

type JsonObject = Record<string, unknown>;
const asObject = (v: unknown): JsonObject => (v && typeof v === 'object' ? (v as JsonObject) : {});

export function describeFeedAction(action: string, after: unknown): string {
  const base = TEAM_LABELS[action] ?? describeProjectActivityAction(action).toLowerCase();
  const a = asObject(after);
  const detail = typeof a.title === 'string' ? ` "${a.title}"` : typeof a.email === 'string' ? ` (${a.email})` : '';
  const column = typeof a.column === 'string' ? ` to ${a.column}` : '';
  return `${base}${detail}${column}`;
}

/**
 * Newest-first project feed merging activity logs (tasks, comments, approvals, member changes, project events)
 * with deployments. Pagination is keyset on time: pass the previous page's `nextCursor`.
 */
export async function getProjectFeed(userId: string, projectId: string, opts: { cursor?: string | null; limit?: number } = {}) {
  const access = await requireProjectCapability(userId, projectId, 'view_project');
  if (!access.ok) return { items: [] as FeedItem[], nextCursor: null as string | null };
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const before = opts.cursor && !Number.isNaN(Date.parse(opts.cursor)) ? new Date(opts.cursor) : null;
  const createdAt = before ? { lt: before } : undefined;

  const [logs, deployments] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where: {
        createdAt,
        action: { not: { startsWith: 'account.' } },
        OR: [
          { targetType: 'Project', targetId: projectId },
          { targetType: 'Workspace', targetId: access.ctx.workspaceId, action: { startsWith: 'team.' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: { id: true, action: true, after: true, createdAt: true, adminId: true, adminEmail: true },
    }),
    prisma.deployment.findMany({
      where: { projectId, createdAt },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: { id: true, version: true, status: true, environment: true, createdAt: true, createdById: true },
    }),
  ]);

  const actorIds = [...new Set([...logs.map((l) => l.adminId), ...deployments.map((d) => d.createdById)].filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
  const nameOf = (id: string | null, fallback?: string | null) => {
    const u = users.find((x) => x.id === id);
    return u?.name ?? u?.email ?? fallback ?? null;
  };

  const items: FeedItem[] = [
    ...logs.map((l) => ({
      id: `log:${l.id}`,
      at: l.createdAt.toISOString(),
      kind: feedKindFor(l.action),
      text: describeFeedAction(l.action, l.after),
      actor: nameOf(l.adminId, l.adminEmail),
    })),
    ...deployments.map((d) => ({
      id: `deploy:${d.id}`,
      at: d.createdAt.toISOString(),
      kind: 'deployment' as const,
      text: `deployed v${d.version} to ${d.environment.toLowerCase()} (${d.status.toLowerCase()})`,
      actor: nameOf(d.createdById),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));

  const page = items.slice(0, limit);
  const nextCursor = items.length > limit ? page[page.length - 1].at : null;
  return { items: page, nextCursor };
}
