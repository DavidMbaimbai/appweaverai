import { prisma } from '@/lib/prisma';

/** A metric value, or null meaning "not available" (never shown as zero). */
export type Metric = number | null;

export type CommandCentreMetrics = {
  content: { generated: Metric; scheduled: Metric; published: Metric; failed: Metric };
  video: { rendering: Metric; completed: Metric };
  conversations: { conversations: Metric; escalations: Metric; supportTickets: Metric };
  growth: { leads: Metric; investorProspects: Metric; outreachSent: Metric; replies: Metric; meetingsBooked: Metric };
  spend: { customerAdsCents: Metric; houseAdsCents: Metric };
  quota: { aiCallsToday: Metric; aiCostTodayCents: Metric; videoJobsToday: Metric; agentActionsToday: Metric };
};

async function safe(read: () => Promise<number>): Promise<Metric> {
  try {
    return await read();
  } catch (error) {
    console.error('[command-centre] metric failed:', error);
    return null;
  }
}

function sum(a: Metric, b: Metric): Metric {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/** Real counts from existing tables for the UTC day containing `now`. */
export async function getCommandCentreMetrics(now = new Date()): Promise<CommandCentreMetrics> {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const today = { gte: start };

  const [
    socialCreated, projectPostsCreated, releasesCreated,
    socialScheduled, projectScheduled, releasesScheduled,
    socialPublished, projectPublished, releasesPublished,
    socialFailed, projectFailed, releasesFailed,
    rendering, completed,
    conversations, escalations, tickets,
    leads, investors, outreachSent, replies, meetings,
    customerSpend, houseSpend,
    aiCalls, aiCost, videoJobs, agentActions,
  ] = await Promise.all([
    safe(() => prisma.socialPost.count({ where: { createdAt: today } })),
    safe(() => prisma.projectPost.count({ where: { createdAt: today } })),
    safe(() => prisma.videoRelease.count({ where: { createdAt: today } })),
    safe(() => prisma.socialPost.count({ where: { status: 'PENDING' } })),
    safe(() => prisma.projectPost.count({ where: { status: 'SCHEDULED' } })),
    safe(() => prisma.videoRelease.count({ where: { status: 'SCHEDULED' } })),
    safe(() => prisma.socialPost.count({ where: { status: 'POSTED', postedAt: today } })),
    safe(() => prisma.projectPost.count({ where: { status: 'PUBLISHED', publishedAt: today } })),
    safe(() => prisma.videoRelease.count({ where: { status: 'PUBLISHED', publishedAt: today } })),
    safe(() => prisma.socialPost.count({ where: { status: 'FAILED', updatedAt: today } })),
    safe(() => prisma.projectPost.count({ where: { status: 'FAILED', updatedAt: today } })),
    safe(() => prisma.videoRelease.count({ where: { status: 'FAILED', updatedAt: today } })),
    safe(() => prisma.videoJob.count({ where: { status: { in: ['QUEUED', 'SUBMITTED', 'RUNNING'] } } })),
    safe(() => prisma.videoJob.count({ where: { status: 'SUCCEEDED', updatedAt: today } })),
    safe(() => prisma.socialInteraction.count({ where: { createdAt: today } })),
    safe(() => prisma.socialInteraction.count({ where: { escalate: true, createdAt: today } })),
    safe(() => prisma.projectSupportTicket.count({ where: { createdAt: today } })),
    safe(() => prisma.lead.count({ where: { createdAt: today } })),
    safe(async () => (await prisma.investorLead.count({ where: { createdAt: today } })) + (await prisma.hubInvestor.count({ where: { createdAt: today } }))),
    safe(async () => (await prisma.investorLead.count({ where: { sentAt: today } })) + (await prisma.hubInvestorOutreach.count({ where: { sentAt: today } }))),
    safe(() => prisma.hubInvestorReply.count({ where: { createdAt: today } })),
    safe(() => prisma.leadBooking.count({ where: { createdAt: today } })),
    safe(async () => (await prisma.customerAd.aggregate({ _sum: { spendCents: true } }))._sum.spendCents ?? 0),
    safe(async () => (await prisma.adCreative.aggregate({ _sum: { spendCents: true } }))._sum.spendCents ?? 0),
    safe(() => prisma.aiUsageEvent.count({ where: { createdAt: today } })),
    safe(async () => (await prisma.aiUsageEvent.aggregate({ where: { createdAt: today }, _sum: { estimatedCostCents: true } }))._sum.estimatedCostCents ?? 0),
    safe(() => prisma.videoJob.count({ where: { createdAt: today } })),
    safe(() => prisma.agentActivity.count({ where: { createdAt: today } })),
  ]);

  return {
    content: {
      generated: sum(sum(socialCreated, projectPostsCreated), releasesCreated),
      scheduled: sum(sum(socialScheduled, projectScheduled), releasesScheduled),
      published: sum(sum(socialPublished, projectPublished), releasesPublished),
      failed: sum(sum(socialFailed, projectFailed), releasesFailed),
    },
    video: { rendering, completed },
    conversations: { conversations, escalations, supportTickets: tickets },
    growth: { leads, investorProspects: investors, outreachSent, replies, meetingsBooked: meetings },
    spend: { customerAdsCents: customerSpend, houseAdsCents: houseSpend },
    quota: { aiCallsToday: aiCalls, aiCostTodayCents: aiCost, videoJobsToday: videoJobs, agentActionsToday: agentActions },
  };
}
