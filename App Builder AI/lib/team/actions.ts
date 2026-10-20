'use server';

import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/require-user';

import { requestApproval, decideApproval, cancelApproval, listApprovals } from './approvals';
import { getProjectFeed } from './activity';
import {
  addComment,
  configureColumns,
  createTask,
  deleteComment,
  deleteTask,
  getBoard,
  linkTask,
  listComments,
  moveTask,
  unlinkTask,
  updateTask,
  type BoardFilters,
} from './board';
import { acceptInvitation, createInvitation, resendInvitation, revokeInvitation } from './invitations';
import { changeMemberRole, leaveWorkspace, removeMember } from './members';
import {
  NOTIFICATION_KINDS,
  listNotifications,
  markNotificationsRead,
  setNotificationPreference,
  type NotificationKind,
} from './notifications';
import { transferWorkspaceOwnership } from './ownership';
import { setMemberSpendLimit } from './spend';

type Failure = { ok: false; error: string };
const SIGN_IN: Failure = { ok: false, error: 'You must be signed in.' };

async function currentUser() {
  const auth = await requireUserId();
  return auth.userId;
}

function refresh() {
  revalidatePath('/app/team');
}

export async function inviteMemberAction(input: { workspaceId?: string; projectId?: string; email: string; role: string }) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await createInvitation({ actorId: userId, ...input });
  refresh();
  return result;
}

export async function resendInvitationAction(invitationId: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await resendInvitation({ actorId: userId, invitationId });
  refresh();
  return result;
}

export async function revokeInvitationAction(invitationId: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await revokeInvitation({ actorId: userId, invitationId });
  refresh();
  return result;
}

export async function acceptInvitationAction(token: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await acceptInvitation({ token, userId });
  refresh();
  return result;
}

export async function changeMemberRoleAction(input: { workspaceId?: string; projectId?: string; targetUserId: string; role: string }) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await changeMemberRole({ actorId: userId, ...input });
  refresh();
  return result;
}

export async function removeMemberAction(input: { workspaceId?: string; projectId?: string; targetUserId: string }) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await removeMember({ actorId: userId, ...input });
  refresh();
  return result;
}

export async function leaveWorkspaceAction(workspaceId: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await leaveWorkspace({ userId, workspaceId });
  refresh();
  return result;
}

export async function transferOwnershipAction(input: { workspaceId: string; newOwnerId: string; confirmSlug: string }) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await transferWorkspaceOwnership({ actorId: userId, ...input });
  refresh();
  return result;
}

export async function setSpendLimitAction(input: { workspaceId: string; userId: string; monthlyLimit: number | null }) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const result = await setMemberSpendLimit({ actorId: userId, ...input });
  refresh();
  return result;
}

// ---- Board ---------------------------------------------------------------

export async function loadBoardAction(projectId: string, filters: BoardFilters = {}) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return getBoard(userId, projectId, filters);
}

type TaskPayload = {
  title: string;
  description?: string | null;
  labels?: string[];
  priority?: string;
  dueDate?: string | null;
  sprint?: string | null;
  assigneeId?: string | null;
};

export async function createTaskAction(projectId: string, columnId: string, task: TaskPayload) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return createTask({ userId, projectId, columnId, ...task });
}

export async function updateTaskAction(projectId: string, taskId: string, expectedVersion: number, task: TaskPayload) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return updateTask({ userId, projectId, taskId, expectedVersion, ...task });
}

/** Returns the authoritative board so the client can reconcile its optimistic state. */
export async function moveTaskAction(projectId: string, taskId: string, columnId: string, beforeTaskId: string | null, filters: BoardFilters = {}) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  const moved = await moveTask({ userId, projectId, taskId, columnId, beforeTaskId });
  const board = await getBoard(userId, projectId, filters);
  return moved.ok ? board : { ...moved, board: board.ok ? board.board : undefined };
}

export async function deleteTaskAction(projectId: string, taskId: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return deleteTask({ userId, projectId, taskId });
}

export async function configureColumnsAction(projectId: string, action: Parameters<typeof configureColumns>[0]['action']) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return configureColumns({ userId, projectId, action });
}

export async function loadCommentsAction(projectId: string, taskId: string) {
  const userId = await currentUser();
  if (!userId) return [];
  return listComments(userId, projectId, taskId);
}

export async function addCommentAction(projectId: string, taskId: string, body: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return addComment({ userId, projectId, taskId, body });
}

export async function deleteCommentAction(projectId: string, commentId: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return deleteComment({ userId, projectId, commentId });
}

export async function linkTaskAction(projectId: string, taskId: string, kind: string, refId: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return linkTask({ userId, projectId, taskId, kind, refId });
}

export async function unlinkTaskAction(projectId: string, linkId: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return unlinkTask({ userId, projectId, linkId });
}

// ---- Approvals -----------------------------------------------------------

export async function requestApprovalAction(input: { projectId: string; taskId?: string | null; kind: string; title: string; details?: string | null; amountCredits?: number | null }) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return requestApproval({ userId, ...input });
}

export async function decideApprovalAction(input: { projectId: string; approvalId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string | null }) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return decideApproval({ userId, ...input });
}

export async function cancelApprovalAction(projectId: string, approvalId: string) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  return cancelApproval({ userId, projectId, approvalId });
}

export async function loadApprovalsAction(projectId: string) {
  const userId = await currentUser();
  if (!userId) return [];
  return listApprovals(userId, projectId);
}

// ---- Feed and notifications ----------------------------------------------

export async function loadFeedAction(projectId: string, cursor: string | null) {
  const userId = await currentUser();
  if (!userId) return { items: [], nextCursor: null };
  return getProjectFeed(userId, projectId, { cursor });
}

export async function loadNotificationsAction() {
  const userId = await currentUser();
  if (!userId) return { items: [], unread: 0 };
  const { items, unread } = await listNotifications(userId);
  return {
    unread,
    items: items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
  };
}

export async function markNotificationsReadAction(ids?: string[]) {
  const userId = await currentUser();
  if (!userId) return 0;
  return markNotificationsRead(userId, ids);
}

export async function setNotificationPreferenceAction(kind: string, value: { inApp: boolean; email: boolean }) {
  const userId = await currentUser();
  if (!userId) return SIGN_IN;
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'Unknown notification type.' } as Failure;
  await setNotificationPreference(userId, kind as NotificationKind, value);
  return { ok: true as const };
}
