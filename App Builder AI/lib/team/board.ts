import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/lib/generated/prisma/client';

import { requireProjectCapability, resolveProjectRole, type ProjectRoleContext } from './access';
import {
  DEFAULT_COLUMNS,
  POSITION_STEP,
  planMove,
  resolveMentions,
  sanitizeTaskInput,
  type MentionCandidate,
} from './board-logic';
import { recordTeamEvent } from './events';
import { notifyUser } from './notifications';

export type BoardResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean };
const fail = (error: string, conflict = false) => ({ ok: false, error, conflict }) as const;

const LINK_KINDS = ['CHAT_PROMPT', 'CHECKPOINT', 'CAMPAIGN', 'DEPLOYMENT'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export type BoardFilters = {
  assigneeId?: string | null;
  label?: string | null;
  priority?: string | null;
  sprint?: string | null;
  q?: string | null;
};

export type BoardTaskView = {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  labels: string[];
  priority: string;
  dueDate: string | null;
  sprint: string | null;
  position: number;
  version: number;
  commentCount: number;
  links: Array<{ id: string; kind: string; refId: string; label: string }>;
  pendingApprovals: number;
};

export type BoardView = {
  columns: Array<{ id: string; name: string; position: number; isDone: boolean; tasks: BoardTaskView[] }>;
  members: Array<{ id: string; name: string | null; username: string | null; email: string | null; image: string | null }>;
};

/** Creates the default columns once per project; an advisory lock keeps concurrent first visits from duplicating them. */
export async function ensureColumns(projectId: string) {
  const existing = await prisma.boardColumn.count({ where: { projectId } });
  if (existing > 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`board:${projectId}`}))`;
    if ((await tx.boardColumn.count({ where: { projectId } })) > 0) return;
    await tx.boardColumn.createMany({
      data: DEFAULT_COLUMNS.map((c, i) => ({ projectId, name: c.name, isDone: c.isDone, position: i })),
    });
  });
}

async function projectMembers(projectId: string, workspaceId: string, ownerId: string) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      members: { select: { userId: true } },
      projects: { where: { id: projectId }, select: { members: { select: { userId: true } } } },
    },
  });
  const ids = new Set<string>([ownerId, ...(ws?.members.map((m) => m.userId) ?? [])]);
  for (const m of ws?.projects[0]?.members ?? []) ids.add(m.userId);
  return prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, username: true, email: true, image: true },
  });
}

export async function getBoard(userId: string, projectId: string, filters: BoardFilters = {}): Promise<BoardResult<{ board: BoardView; role: ProjectRoleContext['role'] }>> {
  const access = await requireProjectCapability(userId, projectId, 'view_project');
  if (!access.ok) return fail(access.error);
  await ensureColumns(projectId);

  const where: Prisma.BoardTaskWhereInput = { projectId };
  if (filters.assigneeId) where.assigneeId = filters.assigneeId === 'none' ? null : filters.assigneeId;
  if (filters.label) where.labels = { has: filters.label };
  if (filters.priority && ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(filters.priority)) where.priority = filters.priority as 'LOW';
  if (filters.sprint) where.sprint = filters.sprint;
  if (filters.q?.trim()) where.title = { contains: filters.q.trim(), mode: 'insensitive' };

  const [columns, members] = await Promise.all([
    prisma.boardColumn.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      include: {
        tasks: {
          where,
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: {
            links: { select: { id: true, kind: true, refId: true, label: true } },
            _count: { select: { comments: { where: { deletedAt: null } } } },
            approvals: { where: { status: 'PENDING' }, select: { id: true } },
          },
        },
      },
    }),
    projectMembers(projectId, access.ctx.workspaceId, access.ctx.workspaceOwnerId),
  ]);

  return {
    ok: true,
    role: access.ctx.role,
    board: {
      members,
      columns: columns.map((c) => ({
        id: c.id,
        name: c.name,
        position: c.position,
        isDone: c.isDone,
        tasks: c.tasks.map((t) => ({
          id: t.id,
          columnId: t.columnId,
          title: t.title,
          description: t.description,
          assigneeId: t.assigneeId,
          labels: t.labels,
          priority: t.priority,
          dueDate: t.dueDate?.toISOString() ?? null,
          sprint: t.sprint,
          position: t.position,
          version: t.version,
          commentCount: t._count.comments,
          links: t.links,
          pendingApprovals: t.approvals.length,
        })),
      })),
    },
  };
}

async function taskHref(ctx: ProjectRoleContext, taskId: string) {
  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { slug: true, workspace: { select: { slug: true } } },
  });
  return project ? `${appBaseUrl()}/app/projects/${project.workspace.slug}/${project.slug}/board?task=${taskId}` : null;
}

async function assertAssignee(ctx: ProjectRoleContext, assigneeId: string | null) {
  if (!assigneeId) return true;
  return Boolean(await resolveProjectRole(assigneeId, ctx.projectId));
}

type TaskFields = {
  title?: unknown;
  description?: unknown;
  labels?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  sprint?: unknown;
};

export async function createTask(input: { userId: string; projectId: string; columnId: string; assigneeId?: string | null } & TaskFields): Promise<BoardResult<{ taskId: string }>> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'manage_board');
  if (!access.ok) return fail(access.error);
  const clean = sanitizeTaskInput(input);
  if (!clean.ok) return fail(clean.error);
  const column = await prisma.boardColumn.findFirst({ where: { id: input.columnId, projectId: input.projectId }, select: { id: true } });
  if (!column) return fail('Column not found.');
  if (!(await assertAssignee(access.ctx, input.assigneeId ?? null))) return fail('The assignee does not have access to this project.');

  const last = await prisma.boardTask.aggregate({ where: { columnId: column.id }, _max: { position: true } });
  const task = await prisma.boardTask.create({
    data: {
      ...clean.value,
      projectId: input.projectId,
      columnId: column.id,
      assigneeId: input.assigneeId ?? null,
      position: (last._max.position ?? 0) + POSITION_STEP,
      createdById: input.userId,
    },
    select: { id: true, title: true, assigneeId: true },
  });
  await recordTeamEvent({ actorId: input.userId, action: 'task.created', target: { type: 'Project', id: input.projectId }, after: { taskId: task.id, title: task.title } });
  if (task.assigneeId) {
    await notifyUser({ userId: task.assigneeId, actorId: input.userId, kind: 'ASSIGNMENT', title: `You were assigned: ${task.title}`, href: await taskHref(access.ctx, task.id), projectId: input.projectId });
  }
  return { ok: true, taskId: task.id };
}

/** `expectedVersion` is the version the editor loaded; a mismatch means someone else changed the task first. */
export async function updateTask(input: { userId: string; projectId: string; taskId: string; expectedVersion: number; assigneeId?: string | null } & TaskFields): Promise<BoardResult<{ version: number }>> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'manage_board');
  if (!access.ok) return fail(access.error);
  const clean = sanitizeTaskInput(input);
  if (!clean.ok) return fail(clean.error);
  const before = await prisma.boardTask.findFirst({ where: { id: input.taskId, projectId: input.projectId }, select: { assigneeId: true } });
  if (!before) return fail('Task not found.');
  const assigneeId = input.assigneeId === undefined ? before.assigneeId : input.assigneeId;
  if (!(await assertAssignee(access.ctx, assigneeId))) return fail('The assignee does not have access to this project.');

  const updated = await prisma.boardTask.updateMany({
    where: { id: input.taskId, projectId: input.projectId, version: input.expectedVersion },
    data: { ...clean.value, assigneeId, version: { increment: 1 } },
  });
  if (updated.count !== 1) return fail('Someone else changed this task. Your view has been refreshed.', true);

  await recordTeamEvent({ actorId: input.userId, action: 'task.updated', target: { type: 'Project', id: input.projectId }, after: { taskId: input.taskId, title: clean.value.title } });
  if (assigneeId && assigneeId !== before.assigneeId) {
    await recordTeamEvent({ actorId: input.userId, action: 'task.assigned', target: { type: 'Project', id: input.projectId }, after: { taskId: input.taskId, assigneeId } });
    await notifyUser({ userId: assigneeId, actorId: input.userId, kind: 'ASSIGNMENT', title: `You were assigned: ${clean.value.title}`, href: await taskHref(access.ctx, input.taskId), projectId: input.projectId });
  }
  return { ok: true, version: input.expectedVersion + 1 };
}

/** Moves a card to `columnId`, above `beforeTaskId` (or to the bottom). The destination is renumbered when gaps run out. */
export async function moveTask(input: { userId: string; projectId: string; taskId: string; columnId: string; beforeTaskId?: string | null }): Promise<BoardResult> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'manage_board');
  if (!access.ok) return fail(access.error);

  const moved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`board:${input.projectId}`}))`;
    const task = await tx.boardTask.findFirst({ where: { id: input.taskId, projectId: input.projectId }, select: { id: true, columnId: true, title: true } });
    const column = await tx.boardColumn.findFirst({ where: { id: input.columnId, projectId: input.projectId }, select: { id: true, name: true } });
    if (!task || !column) return null;
    const siblings = await tx.boardTask.findMany({ where: { columnId: column.id }, select: { id: true, position: true } });
    const plan = planMove(siblings, task.id, input.beforeTaskId ?? null);
    if (plan.rebalance) {
      for (const [i, id] of plan.rebalance.entries()) {
        await tx.boardTask.update({ where: { id }, data: { position: (i + 1) * POSITION_STEP, ...(id === task.id ? { columnId: column.id, version: { increment: 1 } } : {}) } });
      }
    } else {
      await tx.boardTask.update({ where: { id: task.id }, data: { columnId: column.id, position: plan.position, version: { increment: 1 } } });
    }
    return { title: task.title, from: task.columnId, to: column };
  });
  if (!moved) return fail('Task or column not found.');
  if (moved.from !== moved.to.id) {
    await recordTeamEvent({ actorId: input.userId, action: 'task.moved', target: { type: 'Project', id: input.projectId }, after: { taskId: input.taskId, title: moved.title, column: moved.to.name } });
  }
  return { ok: true };
}

export async function deleteTask(input: { userId: string; projectId: string; taskId: string }): Promise<BoardResult> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'manage_board');
  if (!access.ok) return fail(access.error);
  const task = await prisma.boardTask.findFirst({ where: { id: input.taskId, projectId: input.projectId }, select: { title: true } });
  if (!task) return fail('Task not found.');
  await prisma.boardTask.deleteMany({ where: { id: input.taskId, projectId: input.projectId } });
  await recordTeamEvent({ actorId: input.userId, action: 'task.deleted', target: { type: 'Project', id: input.projectId }, before: { taskId: input.taskId, title: task.title } });
  return { ok: true };
}

/** Column configuration is an admin job: add, rename, reorder, mark done, delete (tasks move to another column). */
export async function configureColumns(input: {
  userId: string;
  projectId: string;
  action: { type: 'add'; name: string; isDone?: boolean } | { type: 'rename'; columnId: string; name: string } | { type: 'reorder'; columnIds: string[] } | { type: 'delete'; columnId: string; moveToColumnId: string };
}): Promise<BoardResult> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'manage_members');
  if (!access.ok) return fail(access.error);
  await ensureColumns(input.projectId);
  const a = input.action;
  const clean = (name: string) => name.trim().slice(0, 40);

  if (a.type === 'add') {
    if (!clean(a.name)) return fail('Name the column.');
    const count = await prisma.boardColumn.count({ where: { projectId: input.projectId } });
    if (count >= 12) return fail('A board can have up to 12 columns.');
    await prisma.boardColumn.create({ data: { projectId: input.projectId, name: clean(a.name), isDone: Boolean(a.isDone), position: count } });
  } else if (a.type === 'rename') {
    if (!clean(a.name)) return fail('Name the column.');
    const r = await prisma.boardColumn.updateMany({ where: { id: a.columnId, projectId: input.projectId }, data: { name: clean(a.name) } });
    if (r.count !== 1) return fail('Column not found.');
  } else if (a.type === 'reorder') {
    const cols = await prisma.boardColumn.findMany({ where: { projectId: input.projectId }, select: { id: true } });
    if (cols.length !== a.columnIds.length || !cols.every((c) => a.columnIds.includes(c.id))) return fail('Column list is out of date.');
    await prisma.$transaction(a.columnIds.map((id, i) => prisma.boardColumn.update({ where: { id }, data: { position: i } })));
  } else {
    if (a.columnId === a.moveToColumnId) return fail('Choose a different column to move the tasks to.');
    const [col, dest] = await Promise.all([
      prisma.boardColumn.findFirst({ where: { id: a.columnId, projectId: input.projectId } }),
      prisma.boardColumn.findFirst({ where: { id: a.moveToColumnId, projectId: input.projectId } }),
    ]);
    if (!col || !dest) return fail('Column not found.');
    await prisma.$transaction(async (tx) => {
      const last = await tx.boardTask.aggregate({ where: { columnId: dest.id }, _max: { position: true } });
      const moving = await tx.boardTask.findMany({ where: { columnId: col.id }, orderBy: { position: 'asc' }, select: { id: true } });
      let pos = last._max.position ?? 0;
      for (const t of moving) {
        pos += POSITION_STEP;
        await tx.boardTask.update({ where: { id: t.id }, data: { columnId: dest.id, position: pos, version: { increment: 1 } } });
      }
      await tx.boardColumn.delete({ where: { id: col.id } });
    });
  }
  await recordTeamEvent({ actorId: input.userId, action: 'board.columns_changed', target: { type: 'Project', id: input.projectId }, after: { change: a.type } });
  return { ok: true };
}

export async function listComments(userId: string, projectId: string, taskId: string) {
  const access = await requireProjectCapability(userId, projectId, 'view_project');
  if (!access.ok) return [];
  const rows = await prisma.boardTaskComment.findMany({
    where: { taskId, projectId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true, image: true } });
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    mentions: r.mentions,
    createdAt: r.createdAt.toISOString(),
    author: authors.find((a) => a.id === r.authorId) ?? { id: r.authorId, name: null, image: null },
  }));
}

export async function addComment(input: { userId: string; projectId: string; taskId: string; body: string }): Promise<BoardResult<{ commentId: string; mentions: string[] }>> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'comment');
  if (!access.ok) return fail(access.error);
  const body = input.body.trim();
  if (!body) return fail('Write a comment first.');
  if (body.length > 5000) return fail('Comments are limited to 5,000 characters.');
  const task = await prisma.boardTask.findFirst({ where: { id: input.taskId, projectId: input.projectId }, select: { id: true, title: true } });
  if (!task) return fail('Task not found.');

  const people = (await projectMembers(input.projectId, access.ctx.workspaceId, access.ctx.workspaceOwnerId)) as MentionCandidate[];
  const mentions = resolveMentions(body, people).filter((id) => id !== input.userId);
  const comment = await prisma.boardTaskComment.create({
    data: { projectId: input.projectId, taskId: task.id, authorId: input.userId, body, mentions },
    select: { id: true },
  });
  await recordTeamEvent({ actorId: input.userId, action: 'task.commented', target: { type: 'Project', id: input.projectId }, after: { taskId: task.id, title: task.title, mentions: mentions.length } });
  const href = await taskHref(access.ctx, task.id);
  const author = await prisma.user.findUnique({ where: { id: input.userId }, select: { name: true, email: true } });
  for (const id of mentions) {
    await notifyUser({ userId: id, actorId: input.userId, kind: 'MENTION', title: `${author?.name ?? author?.email ?? 'Someone'} mentioned you on "${task.title}"`, body, href, projectId: input.projectId });
  }
  return { ok: true, commentId: comment.id, mentions };
}

export async function deleteComment(input: { userId: string; projectId: string; commentId: string }): Promise<BoardResult> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'comment');
  if (!access.ok) return fail(access.error);
  const canModerate = access.ctx.role === 'OWNER' || access.ctx.role === 'ADMIN';
  const r = await prisma.boardTaskComment.updateMany({
    where: { id: input.commentId, projectId: input.projectId, deletedAt: null, ...(canModerate ? {} : { authorId: input.userId }) },
    data: { deletedAt: new Date() },
  });
  return r.count === 1 ? { ok: true } : fail('Comment not found.');
}

/** The referenced chat prompt / checkpoint / campaign / deployment must belong to the same project. */
async function resolveLinkTarget(projectId: string, kind: LinkKind, refId: string): Promise<string | null> {
  if (kind === 'CHAT_PROMPT') {
    const m = await prisma.agentMessage.findFirst({ where: { id: refId, role: 'USER', conversation: { projectId } }, select: { content: true } });
    return m ? m.content.slice(0, 80) : null;
  }
  if (kind === 'CHECKPOINT') {
    return (await prisma.projectCheckpoint.findFirst({ where: { id: refId, projectId }, select: { label: true } }))?.label ?? null;
  }
  if (kind === 'CAMPAIGN') {
    return (await prisma.projectCampaign.findFirst({ where: { id: refId, projectId }, select: { name: true } }))?.name ?? null;
  }
  const d = await prisma.deployment.findFirst({ where: { id: refId, projectId }, select: { version: true, environment: true } });
  return d ? `v${d.version} (${d.environment.toLowerCase()})` : null;
}

export async function linkTask(input: { userId: string; projectId: string; taskId: string; kind: string; refId: string }): Promise<BoardResult> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'manage_board');
  if (!access.ok) return fail(access.error);
  if (!(LINK_KINDS as readonly string[]).includes(input.kind)) return fail('Unknown link type.');
  const task = await prisma.boardTask.findFirst({ where: { id: input.taskId, projectId: input.projectId }, select: { id: true } });
  if (!task) return fail('Task not found.');
  const label = await resolveLinkTarget(input.projectId, input.kind as LinkKind, input.refId);
  if (!label) return fail('That item was not found in this project.');
  await prisma.boardTaskLink.upsert({
    where: { taskId_kind_refId: { taskId: task.id, kind: input.kind as LinkKind, refId: input.refId } },
    create: { projectId: input.projectId, taskId: task.id, kind: input.kind as LinkKind, refId: input.refId, label },
    update: { label },
  });
  return { ok: true };
}

export async function unlinkTask(input: { userId: string; projectId: string; linkId: string }): Promise<BoardResult> {
  const access = await requireProjectCapability(input.userId, input.projectId, 'manage_board');
  if (!access.ok) return fail(access.error);
  const r = await prisma.boardTaskLink.deleteMany({ where: { id: input.linkId, projectId: input.projectId } });
  return r.count === 1 ? { ok: true } : fail('Link not found.');
}
