import { prisma } from '@/lib/prisma';

/** Workspaces and projects that belong to a user; used by both the export and the erasure so they cover the same data. */
export async function resolveUserScope(userId: string) {
  const ownedWorkspaces = await prisma.workspace.findMany({
    where: { ownerId: userId },
    select: { id: true, _count: { select: { members: true } }, members: { select: { userId: true, role: true, joinedAt: true } } },
  });
  const ownedWorkspaceIds = ownedWorkspaces.map((w) => w.id);
  const ownedProjects = ownedWorkspaceIds.length
    ? await prisma.project.findMany({ where: { workspaceId: { in: ownedWorkspaceIds } }, select: { id: true, workspaceId: true } })
    : [];
  return { ownedWorkspaces, ownedWorkspaceIds, ownedProjectIds: ownedProjects.map((p) => p.id) };
}

/** Column names that hold credentials; never exported, even though they belong to the user. */
const SECRET_KEY = /(token|secret|password|passwd|apikey|api_key|encrypted|enc$|hash$|signature)/i;

export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSecrets) as T;
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key) && !/(tokens|tokensUsed|tokenVersion|tokenCount)$/i.test(key)) continue;
      out[key] = stripSecrets(v);
    }
    return out as T;
  }
  return value;
}

export type UserDataSections = Record<string, unknown>;

/** Everything held about the account, keyed by section. Credentials (tokens, password hashes, encrypted secrets) are omitted. */
export async function collectUserData(userId: string): Promise<{ sections: UserDataSections; counts: Record<string, number> }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found.');
  const scope = await resolveUserScope(userId);
  const projectIds = scope.ownedProjectIds;
  const projectScope = { scopeType: 'PROJECT' as const, scopeId: { in: projectIds } };

  const [
    settings, github, accounts, sessions, cliTokens, workspaces, memberships, projects, projectMemberships, preferences,
    agentConversations, deployments, checkpoints, brandKit, savedSections, savedPages, templateFavorites, productReviews,
    feedback, aiUsage, creditAdjustments, creditLedger, marketingWallet, marketingLedger, marketingPurchases, marketingLots,
    socialConnections, metaAds, campaigns, hubProfiles, hubInvestors, hubContacts, hubCalls, hubSms, investorCampaigns,
    investorConsents, investorVoiceCalls, investorMeetingRequests, videoJobs, videoProjects, videoReleases, launchKits,
    adAttributions, customerAds, pipelines, mediaAssets, calendarConnections, meetings, securityEvents, auditEntries,
    leads, conversations, projectReviews, supportTickets, formSubmissions, pageViews, contactConsents, messagingSuppressions,
  ] = await Promise.all([
    prisma.userSettings.findMany({ where: { userId } }),
    prisma.userGithubConnection.findMany({ where: { userId } }),
    prisma.account.findMany({ where: { userId } }),
    prisma.session.findMany({ where: { userId } }),
    prisma.cliToken.findMany({ where: { userId } }),
    prisma.workspace.findMany({ where: { ownerId: userId } }),
    prisma.workspaceMember.findMany({ where: { userId } }),
    prisma.project.findMany({ where: { OR: [{ createdById: userId }, { workspaceId: { in: scope.ownedWorkspaceIds } }] } }),
    prisma.projectMember.findMany({ where: { userId } }),
    prisma.userProjectPreference.findMany({ where: { userId } }),
    prisma.agentConversation.findMany({ where: { userId }, include: { messages: true, toolCalls: true } }),
    prisma.deployment.findMany({ where: { createdById: userId } }),
    prisma.projectCheckpoint.findMany({ where: { createdById: userId } }),
    prisma.userBrandKit.findMany({ where: { userId } }),
    prisma.userSavedSection.findMany({ where: { userId } }),
    prisma.userSavedPage.findMany({ where: { userId } }),
    prisma.userTemplateFavorite.findMany({ where: { userId } }),
    prisma.productReview.findMany({ where: { userId } }),
    prisma.feedbackMessage.findMany({ where: { userId } }),
    prisma.aiUsageEvent.findMany({ where: { userId } }),
    prisma.creditAdjustment.findMany({ where: { userId } }),
    prisma.creditLedger.findMany({ where: { userId } }),
    prisma.marketingWallet.findMany({ where: { userId } }),
    prisma.marketingLedger.findMany({ where: { userId } }),
    prisma.marketingPurchase.findMany({ where: { userId } }),
    prisma.marketingCreditLot.findMany({ where: { userId } }),
    prisma.socialConnection.findMany({ where: { userId } }),
    prisma.metaAdConnection.findMany({ where: { userId } }),
    prisma.projectCampaign.findMany({ where: { userId }, include: { posts: true } }),
    prisma.investorHubProfile.findMany({ where: { userId } }),
    prisma.hubInvestor.findMany({ where: { userId }, include: { activities: true, outreach: true, replies: true } }),
    prisma.hubInvestorContact.findMany({ where: { userId } }),
    prisma.hubInvestorCall.findMany({ where: { userId } }),
    prisma.hubInvestorSms.findMany({ where: { userId } }),
    prisma.investorCampaign.findMany({ where: { userId }, include: { targets: { include: { sends: true } } } }),
    prisma.investorConsent.findMany({ where: { userId } }),
    prisma.investorVoiceCall.findMany({ where: { userId } }),
    prisma.investorMeetingRequest.findMany({ where: { userId } }),
    prisma.videoJob.findMany({ where: { userId } }),
    prisma.videoProject.findMany({ where: { userId }, include: { scenes: true } }),
    prisma.videoRelease.findMany({ where: { userId } }),
    prisma.launchKit.findMany({ where: { userId } }),
    prisma.adAttribution.findMany({ where: { userId } }),
    prisma.customerAd.findMany({ where: { userId } }),
    prisma.contentPipeline.findMany({ where: { ownerUserId: userId }, include: { runs: true } }),
    prisma.mediaAsset.findMany({ where: { OR: [{ ownerUserId: userId }, { projectId: { in: projectIds } }] } }),
    prisma.calendarConnection.findMany({ where: { OR: [{ ownerId: userId }, { scopeKey: { in: projectIds } }] } }),
    prisma.meeting.findMany({ where: { OR: [{ hostUserId: userId }, { scopeType: 'PROJECT', scopeId: { in: projectIds } }] } }),
    prisma.securityEvent.findMany({ where: { subjectId: userId } }),
    prisma.adminAuditLog.findMany({ where: { OR: [{ adminId: userId }, { targetId: userId }] } }),
    prisma.lead.findMany({ where: { projectId: { in: projectIds } }, include: { activities: true, followUps: true, drafts: true } }),
    prisma.conversation.findMany({ where: projectScope, include: { messages: true } }),
    prisma.projectReview.findMany({ where: { projectId: { in: projectIds } } }),
    prisma.projectSupportTicket.findMany({ where: { projectId: { in: projectIds } } }),
    prisma.projectFormSubmission.findMany({ where: { projectId: { in: projectIds } } }),
    prisma.projectPageView.count({ where: { projectId: { in: projectIds } } }),
    prisma.contactConsent.findMany({ where: projectScope }),
    prisma.messagingSuppression.findMany({ where: projectScope }),
  ]);

  const projectFiles = projectIds.length
    ? await prisma.projectFile.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, path: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true } })
    : [];

  const projectMemories = projectIds.length
    ? await prisma.projectMemory.findMany({ where: { projectId: { in: projectIds } } })
    : [];
  const projectCodeMap = projectIds.length
    ? await prisma.projectCodeMapEntry.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, path: true, purpose: true, exports: true, routes: true, dependencies: true, updatedAt: true } })
    : [];

  const sections: UserDataSections = stripSecrets({
    projectMemories, projectCodeMap,
    account: user,
    settings, githubConnection: github, loginProviders: accounts, sessions, cliTokens,
    workspaces, workspaceMemberships: memberships, projects, projectFiles, projectMemberships, projectPreferences: preferences,
    agentConversations, deployments, checkpoints, brandKit, savedSections, savedPages, templateFavorites,
    productReviews, feedback,
    aiUsage, creditAdjustments, creditLedger, marketingWallet, marketingLedger, marketingPurchases, marketingCreditLots: marketingLots,
    socialConnections, metaAdsConnections: metaAds, projectCampaigns: campaigns,
    investorHubProfiles: hubProfiles, hubInvestors, hubInvestorContacts: hubContacts, hubInvestorCalls: hubCalls, hubInvestorSms: hubSms,
    investorCampaigns, investorConsents, investorVoiceCalls, investorMeetingRequests,
    videoJobs, videoProjects, videoReleases, launchKits, adAttributions, customerAds, contentPipelines: pipelines, mediaAssets,
    calendarConnections, meetings, securityEvents, auditLog: auditEntries,
    leads, conversations, projectReviews, projectSupportTickets: supportTickets, projectFormSubmissions: formSubmissions,
    contactConsents, messagingSuppressions,
    analytics: { projectPageViews: pageViews, note: 'Page views are aggregate analytics about your sites\' visitors; only the count is included.' },
  });

  const counts: Record<string, number> = {};
  for (const [name, value] of Object.entries(sections)) counts[name] = Array.isArray(value) ? value.length : value ? 1 : 0;
  return { sections, counts };
}
