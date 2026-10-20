import { rm } from 'node:fs/promises';
import path from 'node:path';

import { Prisma } from '@/lib/generated/prisma/client';
import { PROJECT_WORKSPACE_ROOT } from '@/lib/project-files';
import { prisma } from '@/lib/prisma';
import { decryptSecret } from '@/lib/crypto/secret-box';
import { getStripeClient, isStripeConfigured } from '@/lib/stripe';

import { hashMessagingSuppressions, hashOutreachSuppressions } from './anonymise';
import { erasedEmailFor, isErasedEmail, normalizeEmailAddress } from './identifiers';
import { deleteObjects, privacyStorageConfigured } from './storage';
import { suppressEmailHashed } from './suppression';
import { eraseGrowthUserData } from '../growth-bi/erase';
import { resolveUserScope } from './user-data';

export const DELETION_GRACE_DAYS = Math.max(1, Number(process.env.PRIVACY_DELETION_GRACE_DAYS) || 14);
const MAX_ATTEMPTS = 5;

/** Calls out to systems that are not our database. Injected so tests never touch Stripe, Google or S3. */
export type ErasureDeps = {
  cancelSubscription(subscriptionId: string): Promise<void>;
  scrubBillingCustomer(customerId: string): Promise<void>;
  revokeCalendarToken(provider: string, refreshToken: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<void>;
  /** Removes the on-disk project workspaces (ProjectFile content) for erased projects. */
  deleteProjectWorkspaces(projectIds: string[]): Promise<void>;
};

export const defaultErasureDeps: ErasureDeps = {
  async cancelSubscription(subscriptionId) {
    if (!isStripeConfigured()) return;
    try {
      await getStripeClient().subscriptions.cancel(subscriptionId);
    } catch (error) {
      const err = error as { code?: string; statusCode?: number };
      if (err.code === 'resource_missing' || err.statusCode === 404) return;
      throw error;
    }
  },
  async scrubBillingCustomer(customerId) {
    if (!isStripeConfigured()) return;
    // Invoices and tax records stay at Stripe; only the contact details on the customer object are blanked.
    await getStripeClient().customers.update(customerId, { name: 'Deleted user', email: '', phone: '' }).catch(() => null);
  },
  async revokeCalendarToken(provider, refreshToken) {
    if (provider !== 'GOOGLE') return;
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => null);
  },
  async deleteObjects(keys) {
    if (keys.length === 0 || !privacyStorageConfigured()) return;
    await deleteObjects(keys);
  },
  async deleteProjectWorkspaces(projectIds) {
    for (const id of projectIds) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
      await rm(path.join(PROJECT_WORKSPACE_ROOT, id), { recursive: true, force: true });
    }
  },
};

export type DeletionStatus = {
  status: 'NONE' | 'SCHEDULED' | 'CANCELLED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  requestedAt?: string;
  scheduledFor?: string;
};

export async function getDeletionStatus(userId: string): Promise<DeletionStatus> {
  const row = await prisma.privacyDeletionRequest.findUnique({ where: { userId } });
  if (!row) return { status: 'NONE' };
  return { status: row.status as DeletionStatus['status'], requestedAt: row.requestedAt.toISOString(), scheduledFor: row.scheduledFor.toISOString() };
}

export type DeletionResult = { ok: true; scheduledFor: Date; alreadyScheduled: boolean } | { ok: false; error: string };

/** Schedules deletion after the grace period. Calling it again while scheduled changes nothing. */
export async function requestAccountDeletion(userId: string, options: { now?: Date; source?: string } = {}): Promise<DeletionResult> {
  const now = options.now ?? new Date();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { adminRole: true, email: true } });
  if (!user || isErasedEmail(user.email)) return { ok: false, error: 'Account not found.' };
  if (user.adminRole) return { ok: false, error: 'Platform administrators must have their admin role removed before deleting the account.' };

  const existing = await prisma.privacyDeletionRequest.findUnique({ where: { userId } });
  if (existing && (existing.status === 'SCHEDULED' || existing.status === 'PROCESSING')) {
    return { ok: true, scheduledFor: existing.scheduledFor, alreadyScheduled: true };
  }
  const scheduledFor = new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000);
  const data = { status: 'SCHEDULED', requestedAt: now, scheduledFor, cancelledAt: null, completedAt: null, attempts: 0, error: null, source: options.source ?? 'user' };
  await prisma.privacyDeletionRequest.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return { ok: true, scheduledFor, alreadyScheduled: false };
}

/** Cancels a scheduled deletion; too late once processing has started. */
export async function cancelAccountDeletion(userId: string, now = new Date()) {
  const result = await prisma.privacyDeletionRequest.updateMany({ where: { userId, status: 'SCHEDULED' }, data: { status: 'CANCELLED', cancelledAt: now } });
  return result.count > 0;
}

/** Cron: erases every account whose grace period has ended (and retries earlier failures). */
export async function processDueDeletions(now = new Date(), deps: ErasureDeps = defaultErasureDeps, limit = 10) {
  const due = await prisma.privacyDeletionRequest.findMany({
    where: {
      OR: [
        { status: 'SCHEDULED', scheduledFor: { lte: now } },
        { status: 'FAILED', attempts: { lt: MAX_ATTEMPTS } },
        { status: 'PROCESSING', requestedAt: { lt: new Date(now.getTime() - 3_600_000) }, attempts: { lt: MAX_ATTEMPTS } },
      ],
    },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
  });
  const results: Array<{ userId: string; ok: boolean; error?: string }> = [];
  for (const row of due) {
    try {
      await eraseUserAccount(row.userId, deps, { source: row.source });
      results.push({ userId: row.userId, ok: true });
    } catch (error) {
      results.push({ userId: row.userId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

const IN_FLIGHT_VIDEO = ['QUEUED', 'SUBMITTED', 'RUNNING'] as const;

/**
 * Erases an account and everything it owns. The users row is kept but anonymised so billing, credit and audit
 * records stay referentially intact. Safe to re-run after a partial failure.
 */
export async function eraseUserAccount(userId: string, deps: ErasureDeps = defaultErasureDeps, options: { source?: string } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { erased: false as const, reason: 'not_found' };

  const now = new Date();
  const attemptsData = { status: 'PROCESSING', attempts: { increment: 1 }, error: null } as const;
  await prisma.privacyDeletionRequest.upsert({
    where: { userId },
    create: { userId, status: 'PROCESSING', scheduledFor: now, attempts: 1, source: options.source ?? 'user' },
    update: attemptsData,
  });

  try {
    await runErasure(user, deps);
    await prisma.privacyDeletionRequest.update({ where: { userId }, data: { status: 'COMPLETED', completedAt: new Date(), error: null } });
    return { erased: true as const };
  } catch (error) {
    await prisma.privacyDeletionRequest.update({
      where: { userId },
      data: { status: 'FAILED', error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
    });
    throw error;
  }
}

async function runErasure(user: { id: string; email: string | null; stripeCustomerId: string | null; stripeSubscriptionId: string | null }, deps: ErasureDeps) {
  const userId = user.id;
  const scope = await resolveUserScope(userId);

  // Workspaces shared with other people are handed over; sole-owner workspaces are deleted with their projects.
  const doomedWorkspaceIds: string[] = [];
  for (const workspace of scope.ownedWorkspaces) {
    const others = workspace.members.filter((m) => m.userId !== userId).sort((a, b) => (a.role === 'ADMIN' ? -1 : 0) - (b.role === 'ADMIN' ? -1 : 0) || a.joinedAt.getTime() - b.joinedAt.getTime());
    if (others.length === 0) {
      doomedWorkspaceIds.push(workspace.id);
      continue;
    }
    await prisma.workspace.update({ where: { id: workspace.id }, data: { ownerId: others[0].userId } });
    await prisma.workspaceMember.updateMany({ where: { workspaceId: workspace.id, userId: others[0].userId }, data: { role: 'ADMIN' } });
  }
  const doomedProjects = doomedWorkspaceIds.length
    ? await prisma.project.findMany({ where: { workspaceId: { in: doomedWorkspaceIds } }, select: { id: true } })
    : [];
  const projectIds = doomedProjects.map((p) => p.id);

  // 1. External systems first, so a failure leaves the data in place to retry from.
  if (user.stripeSubscriptionId) await deps.cancelSubscription(user.stripeSubscriptionId);
  const calendars = await prisma.calendarConnection.findMany({ where: { OR: [{ ownerId: userId }, { scopeKey: { in: projectIds } }] } });
  for (const calendar of calendars) {
    if (!calendar.refreshTokenEnc) continue;
    try {
      await deps.revokeCalendarToken(calendar.provider, decryptSecret(calendar.refreshTokenEnc));
    } catch {
      // Revocation is best effort; the stored tokens are deleted below either way.
    }
  }
  const [media, jobs, scenes, exports] = await Promise.all([
    prisma.mediaAsset.findMany({ where: { OR: [{ ownerUserId: userId }, { projectId: { in: projectIds } }] }, select: { key: true } }),
    prisma.videoJob.findMany({ where: { userId }, select: { outputKey: true, thumbnailKey: true, inputImageKey: true } }),
    prisma.videoScene.findMany({ where: { videoProject: { userId } }, select: { referenceImageKey: true } }),
    prisma.privacyExportJob.findMany({ where: { userId }, select: { storageKey: true } }),
  ]);
  const keys = [
    ...media.map((m) => m.key),
    ...jobs.flatMap((j) => [j.outputKey, j.thumbnailKey, j.inputImageKey]),
    ...scenes.map((s) => s.referenceImageKey),
    ...exports.map((e) => e.storageKey),
  ].filter((k): k is string => Boolean(k));
  await deps.deleteObjects(keys);
  await deps.deleteProjectWorkspaces(projectIds);

  // 2. Opt-outs outlive the people they belong to, as hashes.
  const [leadEmails, investorEmails, targetEmails] = await Promise.all([
    prisma.lead.findMany({ where: { projectId: { in: projectIds }, email: { not: null } }, select: { email: true, optedOut: true } }),
    prisma.hubInvestor.findMany({ where: { userId, email: { not: null } }, select: { email: true, emailKey: true, optedOut: true } }),
    prisma.investorCampaignTarget.findMany({ where: { campaign: { userId } }, select: { email: true } }),
  ]);
  for (const lead of leadEmails) if (lead.optedOut && lead.email) await suppressEmailHashed(lead.email, 'OPT_OUT');
  for (const investor of investorEmails) if (investor.optedOut && investor.email) await suppressEmailHashed(investor.email, 'OPT_OUT');
  await hashOutreachSuppressions([
    ...leadEmails.map((l) => l.email ?? ''),
    ...investorEmails.flatMap((i) => [i.email ?? '', i.emailKey ?? '']),
    ...targetEmails.map((t) => t.email),
    user.email ?? '',
  ]);
  await hashMessagingSuppressions({ OR: [{ scopeId: { in: projectIds } }, ...(user.email ? [{ contact: normalizeEmailAddress(user.email) }] : [])] });

  // 3. Scheduled work and in-flight jobs.
  await prisma.videoRelease.updateMany({ where: { userId, status: { in: ['DRAFT', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PAUSED'] } }, data: { status: 'CANCELLED' } });
  await prisma.videoJob.updateMany({ where: { userId, status: { in: [...IN_FLIGHT_VIDEO] } }, data: { status: 'CANCELLED' } });
  await prisma.projectPost.updateMany({ where: { campaign: { userId }, status: { in: ['DRAFT', 'APPROVED', 'SCHEDULED', 'PUBLISHING'] } }, data: { status: 'FAILED', error: 'Account deleted', scheduledAt: null } });
  await prisma.meeting.updateMany({ where: { scopeId: { in: projectIds }, status: { notIn: ['COMPLETED', 'CANCELLED', 'MISSED'] } }, data: { status: 'CANCELLED', cancelReason: 'Account deleted', cancelledAt: new Date() } });
  await prisma.meeting.updateMany({ where: { hostUserId: userId, scopeId: { notIn: projectIds } }, data: { hostUserId: null } });
  await prisma.meeting.updateMany({ where: { assigneeId: userId, scopeId: { notIn: projectIds } }, data: { assigneeId: null } });
  await prisma.meeting.updateMany({ where: { requestedById: userId, scopeId: { notIn: projectIds } }, data: { requestedById: null } });

  // 4. Project-scoped data (rows that reference a project by plain id, then the projects themselves).
  if (projectIds.length > 0) {
    const meetingIds = (await prisma.meeting.findMany({ where: { scopeId: { in: projectIds } }, select: { id: true } })).map((m) => m.id);
    await prisma.meetingReminder.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.meetingAudit.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.meetingNotification.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.meetingSlotProposal.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.meetingSlotLock.deleteMany({ where: { meetingId: { in: meetingIds } } });
    await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } });
    await prisma.meetingType.deleteMany({ where: { scopeId: { in: projectIds } } });
    await prisma.meetingSettings.deleteMany({ where: { scopeKey: { in: projectIds } } });
    await prisma.meetingAvailabilityRule.deleteMany({ where: { resourceKey: { in: projectIds } } });
    await prisma.calendarBookingSync.deleteMany({ where: { scopeKey: { in: projectIds } } });
    await prisma.calendarOAuthState.deleteMany({ where: { scopeKey: { in: projectIds } } });
    await prisma.conversation.deleteMany({ where: { scopeId: { in: projectIds } } });
    await prisma.contactConsent.deleteMany({ where: { scopeId: { in: projectIds } } });
    await prisma.consentProof.deleteMany({ where: { scopeId: { in: projectIds } } });
    await prisma.channelConnection.deleteMany({ where: { scopeId: { in: projectIds } } });
    await prisma.channelVerification.deleteMany({ where: { scopeId: { in: projectIds } } });
    await prisma.agentSetting.deleteMany({ where: { scopeId: { in: projectIds } } });
    await prisma.agentActivity.deleteMany({ where: { scopeId: { in: projectIds } } });
    await prisma.contentPipeline.deleteMany({ where: { scopeKey: { in: projectIds } } });
    await prisma.mediaAsset.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.projectCampaign.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.hubInvestorSms.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.hubInvestorCall.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.hubInvestorContact.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.hubInvestor.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.investorHubProfile.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  }
  if (doomedWorkspaceIds.length > 0) await prisma.workspace.deleteMany({ where: { id: { in: doomedWorkspaceIds } } });

  // 5. Everything keyed to the user directly.
  await prisma.hubInvestorSms.deleteMany({ where: { userId } });
  await prisma.hubInvestorCall.deleteMany({ where: { userId } });
  await prisma.hubInvestorContact.deleteMany({ where: { userId } });
  await prisma.hubInvestor.deleteMany({ where: { userId } });
  await prisma.investorHubProfile.deleteMany({ where: { userId } });
  await prisma.investorCampaign.deleteMany({ where: { userId } });
  await prisma.investorConsent.deleteMany({ where: { userId } });
  await prisma.investorVoiceCall.deleteMany({ where: { userId } });
  await prisma.investorMeetingRequest.deleteMany({ where: { userId } });
  await prisma.projectCampaign.deleteMany({ where: { userId } });
  await prisma.socialConnection.deleteMany({ where: { userId } });
  await prisma.metaAdConnection.deleteMany({ where: { userId } });
  await prisma.customerAd.deleteMany({ where: { userId } });
  await prisma.launchKit.deleteMany({ where: { userId } });
  await prisma.adAttribution.deleteMany({ where: { userId } });
  await eraseGrowthUserData(userId);
  await prisma.videoRelease.deleteMany({ where: { userId } });
  await prisma.videoProject.deleteMany({ where: { userId } });
  await prisma.videoJob.deleteMany({ where: { userId } });
  await prisma.contentPipeline.deleteMany({ where: { ownerUserId: userId } });
  await prisma.mediaAsset.deleteMany({ where: { ownerUserId: userId } });
  await prisma.calendarConnection.deleteMany({ where: { OR: [{ ownerId: userId }, { scopeKey: { in: projectIds } }] } });
  await prisma.calendarOAuthState.deleteMany({ where: { userId } });
  await prisma.meetingNotification.deleteMany({ where: { userId } });
  await prisma.agentConversation.deleteMany({ where: { userId } });
  await prisma.userSettings.deleteMany({ where: { userId } });
  await prisma.userGithubConnection.deleteMany({ where: { userId } });
  await prisma.cliToken.deleteMany({ where: { userId } });
  await prisma.cliDeviceAuthorization.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.workspaceMember.deleteMany({ where: { userId } });
  await prisma.projectMember.deleteMany({ where: { userId } });
  await prisma.userProjectPreference.deleteMany({ where: { userId } });
  await prisma.workspaceInvitation.deleteMany({ where: { invitedById: userId } });
  await prisma.projectInvitation.deleteMany({ where: { invitedById: userId } });
  await prisma.userBrandKit.deleteMany({ where: { userId } });
  await prisma.userSavedSection.deleteMany({ where: { userId } });
  await prisma.userSavedPage.deleteMany({ where: { userId } });
  await prisma.userTemplateFavorite.deleteMany({ where: { userId } });
  await prisma.productReview.deleteMany({ where: { userId } });
  await prisma.feedbackMessage.deleteMany({ where: { OR: [{ userId }, ...(user.email ? [{ userEmail: user.email }] : [])] } });
  await prisma.privacyExportJob.deleteMany({ where: { userId } });
  if (user.email) {
    await prisma.verification.deleteMany({ where: { identifier: { contains: user.email } } });
    await prisma.pendingAuthReminder.deleteMany({ where: { email: user.email } });
  }

  // 6. Audit and security trails stay, minus the personal data in them.
  await prisma.adminAuditLog.updateMany({ where: { OR: [{ adminId: userId }, { targetId: userId }] }, data: { adminEmail: null, ipAddress: null } });
  await prisma.adminAuditLog.updateMany({ where: { targetType: 'User', targetId: userId }, data: { before: Prisma.DbNull, after: Prisma.DbNull } });
  await prisma.adminAccessLog.updateMany({ where: { adminId: userId }, data: { adminEmail: null, ipAddress: null } });
  await prisma.securityEvent.updateMany({
    where: { subjectId: userId },
    data: { ipAddress: null, metadata: Prisma.DbNull, message: 'Security event (details removed after account erasure)' },
  });

  // 7. Billing: the customer's contact details are blanked at Stripe; local billing rows stay untouched.
  if (user.stripeCustomerId) await deps.scrubBillingCustomer(user.stripeCustomerId);

  // 8. Finally anonymise the account row, which keeps ledgers, purchases and usage records attached to a valid user id.
  await prisma.user.update({
    where: { id: userId },
    data: {
      email: erasedEmailFor(userId),
      name: 'Deleted user',
      image: null,
      username: null,
      emailVerified: false,
      adminRole: null,
      accountStatus: 'DISABLED',
      statusReason: 'Account erased at the user\'s request.',
      stripeSubscriptionId: null,
      subscriptionStatus: 'canceled',
      subscriptionPlan: 'free',
      subscriptionCurrentPeriodEnd: null,
    },
  });
}
