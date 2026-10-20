import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

import {
  requireProjectCapability,
  requireWorkspaceCapability,
  resolveProjectRole,
  resolveWorkspaceRole,
} from './access';
import { recordTeamEvent } from './events';
import {
  INVITATION_TTL_MS,
  normalizeInviteEmail,
  signInvitationToken,
  verifyInvitationToken,
} from './invitation-token';
import { notifyUser } from './notifications';
import {
  ROLE_LABELS,
  canGrantRole,
  isTeamRole,
  legacyProjectRoleFor,
  legacyWorkspaceRoleFor,
  type TeamRoleName,
} from './permissions';
import { getSeatUsage, seatsAvailable } from './seats';

export type TeamResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (error: string) => ({ ok: false, error }) as const;

type Scope = { workspaceId: string; projectId: string | null };

/** Resolves the invitation scope and checks the actor may manage members (and grant `role`) there. */
async function authorizeScope(
  actorId: string,
  scope: { workspaceId?: string | null; projectId?: string | null },
  role?: TeamRoleName,
): Promise<TeamResult<{ scope: Scope; actorRole: TeamRoleName }>> {
  let resolved: Scope;
  let actorRole: TeamRoleName;
  if (scope.projectId) {
    const access = await requireProjectCapability(actorId, scope.projectId, 'manage_members');
    if (!access.ok) return fail(access.error);
    resolved = { workspaceId: access.ctx.workspaceId, projectId: access.ctx.projectId };
    actorRole = access.ctx.role;
  } else if (scope.workspaceId) {
    const access = await requireWorkspaceCapability(actorId, scope.workspaceId, 'manage_members');
    if (!access.ok) return fail(access.error);
    resolved = { workspaceId: access.ctx.workspaceId, projectId: null };
    actorRole = access.ctx.role;
  } else {
    return fail('Choose a workspace or project.');
  }
  if (role && !canGrantRole(actorRole, role)) {
    return fail(role === 'OWNER' ? 'Ownership can only be transferred.' : 'You cannot grant a role above your own.');
  }
  return { ok: true, scope: resolved, actorRole };
}

function inviteUrl(token: string) {
  return `${appBaseUrl()}/app/invite/${encodeURIComponent(token)}`;
}

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  tokenVersion: number;
  expiresAt: Date;
  workspaceId: string;
  projectId: string | null;
};

async function sendInvitationEmail(invitation: InvitationRow, inviterName: string) {
  const role = invitation.role as TeamRoleName;
  const [workspace, project] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: invitation.workspaceId }, select: { name: true } }),
    invitation.projectId
      ? prisma.project.findFirst({ where: { id: invitation.projectId, workspaceId: invitation.workspaceId }, select: { name: true } })
      : null,
  ]);
  const token = signInvitationToken({
    id: invitation.id,
    version: invitation.tokenVersion,
    expiresAt: invitation.expiresAt.getTime(),
  });
  const url = inviteUrl(token);
  const where = project ? `the project ${project.name} (${workspace?.name ?? 'workspace'})` : `the workspace ${workspace?.name ?? ''}`;
  const text = `${inviterName} invited you to join ${where} as ${ROLE_LABELS[role]}.\n\nAccept: ${url}\n\nThis link expires on ${invitation.expiresAt.toUTCString()}.`;
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  try {
    await sendEmail({
      to: invitation.email,
      subject: `You're invited to ${project?.name ?? workspace?.name ?? 'a workspace'}`,
      text,
      html: `<p>${esc(inviterName)} invited you to join ${esc(where)} as <strong>${ROLE_LABELS[role]}</strong>.</p><p><a href="${url}">Accept the invitation</a></p><p>This link expires on ${invitation.expiresAt.toUTCString()}.</p>`,
    });
  } catch (error) {
    console.error('[team] invitation email failed:', error);
  }
}

async function isAlreadyMember(email: string, scope: Scope) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return false;
  const ctx = scope.projectId
    ? await resolveProjectRole(user.id, scope.projectId)
    : await resolveWorkspaceRole(user.id, scope.workspaceId);
  return Boolean(ctx);
}

const targetOf = (scope: Scope) =>
  scope.projectId ? ({ type: 'Project', id: scope.projectId } as const) : ({ type: 'Workspace', id: scope.workspaceId } as const);

export async function createInvitation(input: {
  actorId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  email: string;
  role: string;
  now?: Date;
}): Promise<TeamResult<{ invitationId: string }>> {
  if (!isTeamRole(input.role)) return fail('Unknown role.');
  const email = normalizeInviteEmail(input.email);
  if (!email) return fail('Enter a valid email address.');

  const auth = await authorizeScope(input.actorId, input, input.role);
  if (!auth.ok) return auth;
  const { scope } = auth;

  if (await isAlreadyMember(email, scope)) return fail('That person already has access.');

  const now = input.now ?? new Date();
  const duplicate = await prisma.teamInvitation.findFirst({
    where: { workspaceId: scope.workspaceId, projectId: scope.projectId, email, status: 'PENDING', expiresAt: { gt: now } },
    select: { id: true },
  });
  if (duplicate) return fail('That email already has a pending invitation. Resend it instead.');

  const usage = await getSeatUsage(scope.workspaceId, { now });
  if (!usage) return fail('Workspace not found.');
  if (!seatsAvailable(usage)) {
    return fail(`All ${usage.limit} seats are in use (including pending invitations). Upgrade your plan to add people.`);
  }

  const invitation = await prisma.teamInvitation.create({
    data: {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      email,
      role: input.role,
      invitedById: input.actorId,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      lastSentAt: now,
    },
  });
  const inviter = await prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true, email: true } });
  await sendInvitationEmail(invitation, inviter?.name ?? inviter?.email ?? 'A teammate');

  await recordTeamEvent({
    actorId: input.actorId,
    action: 'team.invitation_sent',
    target: targetOf(scope),
    after: { invitationId: invitation.id, email, role: input.role },
  });
  return { ok: true, invitationId: invitation.id };
}

async function loadManagedInvitation(actorId: string, invitationId: string) {
  const invitation = await prisma.teamInvitation.findUnique({ where: { id: invitationId } });
  if (!invitation) return null;
  const auth = await authorizeScope(actorId, invitation, invitation.role as TeamRoleName);
  return auth.ok ? invitation : null;
}

export async function resendInvitation(input: { actorId: string; invitationId: string; now?: Date }): Promise<TeamResult> {
  const invitation = await loadManagedInvitation(input.actorId, input.invitationId);
  if (!invitation || invitation.status !== 'PENDING') return fail('Invitation not found.');
  const now = input.now ?? new Date();
  const updated = await prisma.teamInvitation.update({
    where: { id: invitation.id },
    data: { tokenVersion: { increment: 1 }, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), lastSentAt: now },
  });
  const inviter = await prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true, email: true } });
  await sendInvitationEmail(updated, inviter?.name ?? inviter?.email ?? 'A teammate');
  await recordTeamEvent({
    actorId: input.actorId,
    action: 'team.invitation_resent',
    target: targetOf(updated),
    after: { invitationId: updated.id, email: updated.email },
  });
  return { ok: true };
}

export async function revokeInvitation(input: { actorId: string; invitationId: string }): Promise<TeamResult> {
  const invitation = await loadManagedInvitation(input.actorId, input.invitationId);
  if (!invitation) return fail('Invitation not found.');
  const revoked = await prisma.teamInvitation.updateMany({
    where: { id: invitation.id, status: 'PENDING' },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
  if (revoked.count !== 1) return fail('Invitation not found.');
  await recordTeamEvent({
    actorId: input.actorId,
    action: 'team.invitation_revoked',
    target: targetOf(invitation),
    after: { invitationId: invitation.id, email: invitation.email },
  });
  return { ok: true };
}

export async function listInvitations(actorId: string, scope: { workspaceId?: string | null; projectId?: string | null }) {
  const auth = await authorizeScope(actorId, scope);
  if (!auth.ok) return [];
  return prisma.teamInvitation.findMany({
    where: {
      workspaceId: auth.scope.workspaceId,
      ...(auth.scope.projectId ? { projectId: auth.scope.projectId } : {}),
      status: 'PENDING',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, projectId: true, expiresAt: true, lastSentAt: true },
  });
}

/** What the accept page shows before the user confirms (no state change). */
export async function previewInvitation(token: string, now = new Date()) {
  const claims = verifyInvitationToken(token, now);
  if (!claims) return null;
  const invitation = await prisma.teamInvitation.findUnique({ where: { id: claims.id } });
  if (!invitation || invitation.status !== 'PENDING' || invitation.tokenVersion !== claims.version || invitation.expiresAt <= now) return null;
  const [workspace, project] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: invitation.workspaceId }, select: { name: true } }),
    invitation.projectId ? prisma.project.findUnique({ where: { id: invitation.projectId }, select: { name: true } }) : null,
  ]);
  return {
    email: invitation.email,
    role: invitation.role as TeamRoleName,
    workspaceName: workspace?.name ?? 'Workspace',
    projectName: project?.name ?? null,
  };
}

export async function acceptInvitation(input: { token: string; userId: string; now?: Date }): Promise<
  TeamResult<{ workspaceId: string; projectId: string | null }>
> {
  const now = input.now ?? new Date();
  const claims = verifyInvitationToken(input.token, now);
  if (!claims) return fail('This invitation link is invalid or has expired.');

  const invitation = await prisma.teamInvitation.findUnique({ where: { id: claims.id } });
  if (
    !invitation ||
    invitation.status !== 'PENDING' ||
    invitation.tokenVersion !== claims.version ||
    invitation.expiresAt <= now
  ) {
    return fail('This invitation link is invalid or has expired.');
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true, name: true } });
  if (!user?.email || user.email.toLowerCase() !== invitation.email) {
    return fail(`This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`);
  }

  // The inviter must still be allowed to grant this role; a demoted or removed inviter cannot leave live invitations behind.
  const role = invitation.role as TeamRoleName;
  const inviterScope = { workspaceId: invitation.workspaceId, projectId: invitation.projectId };
  const inviter = await authorizeScope(invitation.invitedById, inviterScope, role);
  if (!inviter.ok) return fail('The person who invited you can no longer grant this access.');

  const usage = await getSeatUsage(invitation.workspaceId, { ignoreInvitationId: invitation.id, now });
  if (!usage) return fail('Workspace not found.');
  const alreadyCounted = await isAlreadyMember(invitation.email, inviterScope);
  if (!alreadyCounted && !seatsAvailable(usage)) return fail('This workspace has no free seats. Ask an admin to upgrade the plan.');

  const accepted = await prisma.$transaction(async (tx) => {
    const claimed = await tx.teamInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING', tokenVersion: invitation.tokenVersion },
      data: { status: 'ACCEPTED', acceptedAt: now, acceptedById: input.userId },
    });
    if (claimed.count !== 1) return false;

    const workspace = await tx.workspace.findUnique({ where: { id: invitation.workspaceId }, select: { ownerId: true } });
    if (!workspace || workspace.ownerId === input.userId) return true;

    if (invitation.projectId) {
      const project = await tx.project.findFirst({ where: { id: invitation.projectId, workspaceId: invitation.workspaceId }, select: { id: true } });
      if (!project) throw new Error('Project no longer exists.');
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: input.userId } },
        create: { projectId: project.id, userId: input.userId, role: legacyProjectRoleFor(role) },
        update: {},
      });
    } else {
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: input.userId } },
        create: { workspaceId: invitation.workspaceId, userId: input.userId, role: legacyWorkspaceRoleFor(role) },
        update: {},
      });
    }
    const scopeKey = invitation.projectId ? `p:${invitation.projectId}` : 'ws';
    await tx.teamRoleAssignment.upsert({
      where: { workspaceId_scopeKey_userId: { workspaceId: invitation.workspaceId, scopeKey, userId: input.userId } },
      create: {
        workspaceId: invitation.workspaceId,
        projectId: invitation.projectId,
        scopeKey,
        userId: input.userId,
        role,
        assignedById: invitation.invitedById,
      },
      update: { role, assignedById: invitation.invitedById },
    });
    return true;
  });
  if (!accepted) return fail('This invitation was already used.');

  await recordTeamEvent({
    actorId: input.userId,
    action: 'team.invitation_accepted',
    target: targetOf(invitation),
    after: { invitationId: invitation.id, role, invitedById: invitation.invitedById },
  });
  await notifyUser({
    userId: invitation.invitedById,
    actorId: input.userId,
    kind: 'INVITATION',
    title: `${user.name ?? user.email} accepted your invitation`,
    body: `${user.email} joined as ${ROLE_LABELS[role]}.`,
    projectId: invitation.projectId,
  });
  return { ok: true, workspaceId: invitation.workspaceId, projectId: invitation.projectId };
}
