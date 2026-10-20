import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Array<{ to: string; text?: string }> = [];

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (m: { to: string; text?: string }) => {
    sent.push(m);
    return { ok: true };
  }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'vitest' }),
}));

import { decideApproval, requestApproval } from '@/lib/team/approvals';
import { addComment, createTask, getBoard, listComments, moveTask, updateTask } from '@/lib/team/board';
import { acceptInvitation, createInvitation, listInvitations, resendInvitation, revokeInvitation } from '@/lib/team/invitations';
import { changeMemberRole, leaveWorkspace, removeMember } from '@/lib/team/members';
import { transferWorkspaceOwnership } from '@/lib/team/ownership';
import { getWorkspaceUsage, setMemberSpendLimit, attributeAndCheckMember } from '@/lib/team/spend';

import { makeProjectFor, makeUser, prisma, uid } from './db';

function tokenFromLastEmail() {
  const text = sent[sent.length - 1]?.text ?? '';
  const match = text.match(/\/app\/invite\/(\S+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function teamSetup() {
  const owner = await makeUser({ email: `${uid('own')}@example.test` });
  await prisma.user.update({ where: { id: owner.id }, data: { emailVerified: true } });
  const { workspace, project } = await makeProjectFor(owner);
  await prisma.workspace.update({ where: { id: workspace.id }, data: { type: 'TEAM' } });
  return { owner, workspace, project };
}

async function join(workspaceId: string, ownerId: string, role: string) {
  const user = await makeUser({ email: `${uid('inv')}@example.test` });
  const invited = await createInvitation({ actorId: ownerId, workspaceId, email: user.email!, role });
  expect(invited.ok).toBe(true);
  const accepted = await acceptInvitation({ token: tokenFromLastEmail(), userId: user.id });
  expect(accepted.ok).toBe(true);
  return user;
}

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = 'integration-secret-integration-secret';
  process.env.TEAM_SEATS_FREE = '5';
});
beforeEach(() => {
  sent.length = 0;
});

describe('invitation lifecycle', () => {
  it('invites, accepts once, and grants only the invited role', async () => {
    const { owner, workspace, project } = await teamSetup();
    const designer = await makeUser();
    const r = await createInvitation({ actorId: owner.id, workspaceId: workspace.id, email: designer.email!.toUpperCase(), role: 'DESIGNER' });
    expect(r.ok).toBe(true);
    const token = tokenFromLastEmail();
    expect(token).not.toBe('');

    const accepted = await acceptInvitation({ token, userId: designer.id });
    expect(accepted.ok).toBe(true);
    expect((await acceptInvitation({ token, userId: designer.id })).ok).toBe(false);

    const board = await getBoard(designer.id, project.id);
    expect(board.ok && board.role).toBe('DESIGNER');
    const audit = await prisma.adminAuditLog.findMany({ where: { action: { startsWith: 'team.' } } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['team.invitation_sent', 'team.invitation_accepted']));
  });

  it('rejects another user, a resent link supersedes the old one, and revoke kills it', async () => {
    const { owner, workspace } = await teamSetup();
    const invitee = await makeUser();
    const stranger = await makeUser();
    await createInvitation({ actorId: owner.id, workspaceId: workspace.id, email: invitee.email!, role: 'VIEWER' });
    const first = tokenFromLastEmail();
    expect((await acceptInvitation({ token: first, userId: stranger.id })).ok).toBe(false);

    const [inv] = await listInvitations(owner.id, { workspaceId: workspace.id });
    expect((await resendInvitation({ actorId: owner.id, invitationId: inv.id })).ok).toBe(true);
    const second = tokenFromLastEmail();
    expect(second).not.toBe(first);
    expect((await acceptInvitation({ token: first, userId: invitee.id })).ok).toBe(false);

    expect((await revokeInvitation({ actorId: owner.id, invitationId: inv.id })).ok).toBe(true);
    expect((await acceptInvitation({ token: second, userId: invitee.id })).ok).toBe(false);
  });

  it('blocks escalation, outsiders, and seat overflow', async () => {
    const { owner, workspace } = await teamSetup();
    const admin = await join(workspace.id, owner.id, 'ADMIN');
    const dev = await join(workspace.id, owner.id, 'DEVELOPER');
    const outsider = await makeUser();

    expect((await createInvitation({ actorId: admin.id, workspaceId: workspace.id, email: 'a@example.test', role: 'OWNER' })).ok).toBe(false);
    expect((await createInvitation({ actorId: dev.id, workspaceId: workspace.id, email: 'b@example.test', role: 'VIEWER' })).ok).toBe(false);
    expect((await createInvitation({ actorId: outsider.id, workspaceId: workspace.id, email: 'c@example.test', role: 'VIEWER' })).ok).toBe(false);

    process.env.TEAM_SEATS_FREE = '3';
    try {
      expect((await createInvitation({ actorId: owner.id, workspaceId: workspace.id, email: 'd@example.test', role: 'VIEWER' })).ok).toBe(false);
    } finally {
      process.env.TEAM_SEATS_FREE = '5';
    }
  });
});

describe('members, last owner and ownership transfer', () => {
  it('protects the owner and prevents self-escalation', async () => {
    const { owner, workspace } = await teamSetup();
    const admin = await join(workspace.id, owner.id, 'ADMIN');
    const dev = await join(workspace.id, owner.id, 'DEVELOPER');

    expect((await removeMember({ actorId: admin.id, workspaceId: workspace.id, targetUserId: owner.id })).ok).toBe(false);
    expect((await changeMemberRole({ actorId: admin.id, workspaceId: workspace.id, targetUserId: owner.id, role: 'VIEWER' })).ok).toBe(false);
    expect((await leaveWorkspace({ userId: owner.id, workspaceId: workspace.id })).ok).toBe(false);
    expect((await changeMemberRole({ actorId: dev.id, workspaceId: workspace.id, targetUserId: dev.id, role: 'ADMIN' })).ok).toBe(false);
    expect((await changeMemberRole({ actorId: admin.id, workspaceId: workspace.id, targetUserId: dev.id, role: 'MARKETER' })).ok).toBe(true);
  });

  it('transfers ownership atomically to a verified member and demotes the old owner', async () => {
    const { owner, workspace } = await teamSetup();
    const admin = await join(workspace.id, owner.id, 'ADMIN');
    await prisma.user.update({ where: { id: admin.id }, data: { emailVerified: true } });

    expect((await transferWorkspaceOwnership({ actorId: admin.id, workspaceId: workspace.id, newOwnerId: admin.id, confirmSlug: workspace.slug })).ok).toBe(false);
    expect((await transferWorkspaceOwnership({ actorId: owner.id, workspaceId: workspace.id, newOwnerId: admin.id, confirmSlug: 'wrong' })).ok).toBe(false);
    const ok = await transferWorkspaceOwnership({ actorId: owner.id, workspaceId: workspace.id, newOwnerId: admin.id, confirmSlug: workspace.slug });
    expect(ok.ok).toBe(true);
    const after = await prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(after.ownerId).toBe(admin.id);
    const old = await prisma.workspaceMember.findFirst({ where: { workspaceId: workspace.id, userId: owner.id } });
    expect(old?.role).toBe('ADMIN');
  });
});

describe('board', () => {
  it('moves and orders tasks, and detects update conflicts', async () => {
    const { owner, project } = await teamSetup();
    const board = await getBoard(owner.id, project.id);
    if (!board.ok) throw new Error('no board');
    const [backlog, progress] = board.board.columns;
    const a = await createTask({ userId: owner.id, projectId: project.id, columnId: backlog.id, title: 'A' });
    const b = await createTask({ userId: owner.id, projectId: project.id, columnId: backlog.id, title: 'B' });
    if (!a.ok || !b.ok) throw new Error('create failed');

    expect((await moveTask({ userId: owner.id, projectId: project.id, taskId: b.taskId, columnId: backlog.id, beforeTaskId: a.taskId })).ok).toBe(true);
    expect((await moveTask({ userId: owner.id, projectId: project.id, taskId: a.taskId, columnId: progress.id })).ok).toBe(true);
    const next = await getBoard(owner.id, project.id);
    if (!next.ok) throw new Error('no board');
    expect(next.board.columns[0].tasks.map((t) => t.title)).toEqual(['B']);
    expect(next.board.columns[1].tasks.map((t) => t.title)).toEqual(['A']);

    const version = next.board.columns[1].tasks[0].version;
    expect((await updateTask({ userId: owner.id, projectId: project.id, taskId: a.taskId, expectedVersion: version, title: 'A2' })).ok).toBe(true);
    const stale = await updateTask({ userId: owner.id, projectId: project.id, taskId: a.taskId, expectedVersion: version, title: 'A3' });
    expect(stale.ok).toBe(false);
    expect(!stale.ok && stale.conflict).toBe(true);
  });

  it('isolates tasks, comments, invitations and approvals between tenants', async () => {
    const a = await teamSetup();
    const b = await teamSetup();
    const boardA = await getBoard(a.owner.id, a.project.id);
    if (!boardA.ok) throw new Error('no board');
    const col = boardA.board.columns[0];
    const task = await createTask({ userId: a.owner.id, projectId: a.project.id, columnId: col.id, title: 'secret plan' });
    if (!task.ok) throw new Error('create failed');
    const comment = await addComment({ userId: a.owner.id, projectId: a.project.id, taskId: task.taskId, body: 'private' });
    expect(comment.ok).toBe(true);
    const approval = await requestApproval({ userId: a.owner.id, projectId: a.project.id, taskId: task.taskId, kind: 'PUBLISH', title: 'Ship it' });
    expect(approval.ok).toBe(true);
    await createInvitation({ actorId: a.owner.id, workspaceId: a.workspace.id, email: 'x@example.test', role: 'VIEWER' });

    expect((await getBoard(b.owner.id, a.project.id)).ok).toBe(false);
    expect((await createTask({ userId: b.owner.id, projectId: a.project.id, columnId: col.id, title: 'x' })).ok).toBe(false);
    expect((await moveTask({ userId: b.owner.id, projectId: a.project.id, taskId: task.taskId, columnId: col.id })).ok).toBe(false);
    expect(await listComments(b.owner.id, a.project.id, task.taskId)).toEqual([]);
    // Task from tenant A addressed through tenant B's own project must not resolve either.
    expect((await addComment({ userId: b.owner.id, projectId: b.project.id, taskId: task.taskId, body: 'hi' })).ok).toBe(false);
    expect(await listInvitations(b.owner.id, { workspaceId: a.workspace.id })).toEqual([]);
    if (approval.ok) {
      expect((await decideApproval({ userId: b.owner.id, projectId: a.project.id, approvalId: approval.approvalId, decision: 'APPROVED' })).ok).toBe(false);
    }
  });
});

describe('approvals', () => {
  it('needs an approver, a reason to reject, no self-approval, and decides once', async () => {
    const { owner, workspace, project } = await teamSetup();
    const marketer = await join(workspace.id, owner.id, 'MARKETER');
    const request = await requestApproval({ userId: marketer.id, projectId: project.id, kind: 'SPEND', title: 'Launch campaign', amountCredits: 50 });
    if (!request.ok) throw new Error('request failed');

    expect((await decideApproval({ userId: marketer.id, projectId: project.id, approvalId: request.approvalId, decision: 'APPROVED' })).ok).toBe(false);
    expect((await decideApproval({ userId: owner.id, projectId: project.id, approvalId: request.approvalId, decision: 'REJECTED' })).ok).toBe(false);
    expect((await decideApproval({ userId: owner.id, projectId: project.id, approvalId: request.approvalId, decision: 'REJECTED', reason: 'Too costly' })).ok).toBe(true);
    expect((await decideApproval({ userId: owner.id, projectId: project.id, approvalId: request.approvalId, decision: 'APPROVED' })).ok).toBe(false);

    const note = await prisma.userNotification.findFirst({ where: { userId: marketer.id, kind: 'APPROVAL_DECIDED' } });
    expect(note).not.toBeNull();
    const audit = await prisma.adminAuditLog.findMany({ where: { action: { startsWith: 'approval.' } } });
    expect(audit.length).toBeGreaterThan(0);
  });
});

describe('member spend limits', () => {
  it('blocks a member whose reservations exceed their limit and ignores released ones', async () => {
    const { owner, workspace, project } = await teamSetup();
    const dev = await join(workspace.id, owner.id, 'MARKETER');
    await setMemberSpendLimit({ actorId: owner.id, workspaceId: workspace.id, userId: dev.id, monthlyLimit: 100 });
    const reserve = (key: string, maxCredits: number, status: 'RESERVED' | 'RELEASED' = 'RESERVED') =>
      prisma.marketingReservation.create({
        data: { userId: owner.id, orgId: workspace.id, projectId: project.id, operation: 'ad', maxCredits, status, idempotencyKey: key, expiresAt: new Date(Date.now() + 3600_000) },
      });
    const attribute = (key: string) =>
      attributeAndCheckMember({ workspaceId: workspace.id, userId: dev.id, projectId: project.id, operation: 'ad', ledgerKey: key });

    await reserve('k1', 60);
    expect((await attribute('k1')).ok).toBe(true);
    await reserve('k2', 50);
    expect((await attribute('k2')).ok).toBe(false);
    expect(await prisma.workspaceUsageEvent.count({ where: { ledgerKey: 'k2' } })).toBe(0);
    await reserve('k3', 500, 'RELEASED');
    expect((await attribute('k3')).ok).toBe(true);
  });

  it('requires manage_members and shows usage only to billing viewers', async () => {
    const { owner, workspace } = await teamSetup();
    const dev = await join(workspace.id, owner.id, 'DEVELOPER');
    expect((await setMemberSpendLimit({ actorId: dev.id, workspaceId: workspace.id, userId: dev.id, monthlyLimit: 1000 })).ok).toBe(false);
    expect((await setMemberSpendLimit({ actorId: owner.id, workspaceId: workspace.id, userId: dev.id, monthlyLimit: 100 })).ok).toBe(true);
    expect((await setMemberSpendLimit({ actorId: owner.id, workspaceId: workspace.id, userId: owner.id, monthlyLimit: 100 })).ok).toBe(false);

    const usage = await getWorkspaceUsage(owner.id, workspace.id);
    expect(usage.ok && usage.rows.find((r) => r.userId === dev.id)?.monthlyLimit).toBe(100);
    expect((await getWorkspaceUsage(dev.id, workspace.id)).ok).toBe(false);
  });
});
