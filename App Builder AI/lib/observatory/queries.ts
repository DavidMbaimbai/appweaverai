import { prisma } from '@/lib/prisma';

import { buildInventory } from './inventory';
import { loadSourceFiles } from './understand';
import {
  averageResponseHours,
  isUnresolvedComplaint,
  sentimentTrend,
  topRecurringIssues,
} from './stats';

const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 40;

export type ObservatoryFilters = {
  q?: string;
  status?: string;
  deployment?: string;
  health?: string;
  complaints?: string;
  page?: number;
};

async function latestPerProject<T extends { projectId: string }>(
  rows: T[],
): Promise<Map<string, T>> {
  const map = new Map<string, T>();
  for (const row of rows) if (!map.has(row.projectId)) map.set(row.projectId, row);
  return map;
}

async function latestHealthMap() {
  const rows = await prisma.projectHealthCheck.findMany({
    where: { checkedAt: { gte: new Date(Date.now() - 7 * DAY) } },
    orderBy: { checkedAt: 'desc' },
    distinct: ['projectId'],
    select: { projectId: true, ok: true, detail: true, checkedAt: true },
  });
  return latestPerProject(rows);
}

async function latestSmokeMap() {
  const rows = await prisma.smokeCheck.findMany({
    where: { checkedAt: { gte: new Date(Date.now() - 7 * DAY) } },
    orderBy: { checkedAt: 'desc' },
    distinct: ['projectId'],
    select: { projectId: true, outcome: true, checkedAt: true },
  });
  return latestPerProject(rows);
}

async function complaintCounts(projectIds?: string[]) {
  const reviews = await prisma.projectReview.findMany({
    where: {
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
      replyStatus: { not: 'SENT' },
      status: { not: 'HIDDEN' },
      OR: [{ sentiment: 'negative' }, { rating: { lte: 2 } }],
    },
    select: { projectId: true, rating: true, sentiment: true, replyStatus: true },
  });
  const counts = new Map<string, number>();
  for (const r of reviews) {
    if (isUnresolvedComplaint(r)) counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1);
  }
  return counts;
}

export async function listObservatory(filters: ObservatoryFilters) {
  const [healthMap, smokeMap, complaints] = await Promise.all([
    latestHealthMap(),
    latestSmokeMap(),
    complaintCounts(),
  ]);

  const where: Record<string, unknown> = { deletedAt: null };
  const and: Record<string, unknown>[] = [];
  const q = filters.q?.trim();
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
        { id: q },
        { createdBy: { email: { contains: q, mode: 'insensitive' } } },
        { createdBy: { name: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  if (filters.status === 'ACTIVE' || filters.status === 'SUSPENDED' || filters.status === 'ARCHIVED') {
    and.push({ adminStatus: filters.status });
  }
  if (filters.deployment === 'LIVE') and.push({ deployments: { some: { isCurrent: true, status: 'LIVE' } } });
  if (filters.deployment === 'NONE') and.push({ deployments: { none: { isCurrent: true, status: 'LIVE' } } });
  if (filters.deployment === 'FAILED') and.push({ deployments: { some: { isCurrent: true, status: 'FAILED' } } });
  if (filters.health === 'unhealthy') {
    and.push({ id: { in: [...healthMap.values()].filter((h) => !h.ok).map((h) => h.projectId) } });
  }
  if (filters.health === 'healthy') {
    and.push({ id: { in: [...healthMap.values()].filter((h) => h.ok).map((h) => h.projectId) } });
  }
  if (filters.complaints === 'open') and.push({ id: { in: [...complaints.keys()] } });
  if (and.length) where.AND = and;

  const page = Math.max(1, filters.page ?? 1);
  const [total, projects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        adminStatus: true,
        updatedAt: true,
        createdBy: { select: { email: true, name: true } },
        workspace: { select: { slug: true } },
        deployments: {
          where: { isCurrent: true },
          take: 1,
          select: { status: true, version: true },
        },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: projects.map((p) => ({
      id: p.id,
      name: p.name,
      workspaceSlug: p.workspace.slug,
      slug: p.slug,
      adminStatus: p.adminStatus,
      updatedAt: p.updatedAt,
      ownerEmail: p.createdBy?.email ?? null,
      ownerName: p.createdBy?.name ?? null,
      deploymentStatus: p.deployments[0]?.status ?? null,
      deploymentVersion: p.deployments[0]?.version ?? null,
      health: healthMap.get(p.id) ? (healthMap.get(p.id)!.ok ? 'healthy' : 'unhealthy') : 'unknown',
      smoke: smokeMap.get(p.id)?.outcome ?? null,
      openComplaints: complaints.get(p.id) ?? 0,
    })),
  };
}

export async function getObservatoryDashboard() {
  const since = new Date(Date.now() - 56 * DAY);
  const [apps, deployed, healthMap, smokeMap, complaints, pendingDrafts, awaitingVerification, reviews] =
    await Promise.all([
      prisma.project.count({ where: { deletedAt: null } }),
      prisma.deployment.findMany({
        where: { isCurrent: true, status: 'LIVE' },
        select: { projectId: true },
      }),
      latestHealthMap(),
      latestSmokeMap(),
      complaintCounts(),
      prisma.projectReview.count({ where: { replyStatus: 'DRAFT' } }),
      prisma.projectIssue.count({ where: { status: { in: ['APPROVED', 'DEPLOYED'] } } }),
      prisma.projectReview.findMany({
        where: { createdAt: { gte: since } },
        select: { rating: true, sentiment: true, topic: true, createdAt: true, repliedAt: true, replyStatus: true },
        take: 5000,
      }),
    ]);

  const deployedIds = new Set(deployed.map((d) => d.projectId));
  return {
    apps,
    deployed: deployedIds.size,
    unhealthy: [...healthMap.values()].filter((h) => !h.ok && deployedIds.has(h.projectId)).length,
    failingSmoke: [...smokeMap.values()].filter((s) => s.outcome !== 'PASS' && deployedIds.has(s.projectId)).length,
    unresolvedComplaints: [...complaints.values()].reduce((a, b) => a + b, 0),
    pendingDrafts,
    awaitingVerification,
    topRecurring: topRecurringIssues(reviews),
    sentimentTrend: sentimentTrend(reviews),
    avgResponseHours: averageResponseHours(reviews),
    measuredReplies: reviews.filter((r) => r.repliedAt).length,
  };
}

export async function getObservatoryDetail(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      adminStatus: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      createdBy: { select: { id: true, email: true, name: true } },
      workspace: { select: { id: true, slug: true, name: true } },
      artifacts: { select: { slug: true, status: true, publishedUrl: true } },
    },
  });
  if (!project) return null;

  const [deployments, health, smoke, features, issues, reviews, tickets, conversations, checkpoints, accessLog, source] =
    await Promise.all([
      prisma.deployment.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, version: true, status: true, visibility: true, domain: true, customDomain: true, isCurrent: true, publishedAt: true, createdAt: true },
      }),
      prisma.projectHealthCheck.findMany({ where: { projectId }, orderBy: { checkedAt: 'desc' }, take: 10 }),
      prisma.smokeCheck.findMany({ where: { projectId }, orderBy: { checkedAt: 'desc' }, take: 10 }),
      prisma.appFeature.findMany({ where: { projectId }, orderBy: { name: 'asc' } }),
      prisma.projectIssue.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.projectReview.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { rating: true, sentiment: true, topic: true, createdAt: true, repliedAt: true, replyStatus: true, status: true, responseState: true },
      }),
      prisma.projectSupportTicket.count({ where: { projectId, status: 'OPEN' } }),
      prisma.agentConversation.findMany({
        where: { projectId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
      }),
      prisma.projectCheckpoint.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, label: true, isAutomatic: true, createdAt: true },
      }),
      prisma.adminAccessLog.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 15 }),
      loadSourceFiles(projectId).catch(() => ({ files: [], newestChange: null })),
    ]);

  const current = deployments.find((d) => d.isCurrent) ?? null;
  const errors = [
    ...health.filter((h) => !h.ok).map((h) => ({ source: 'health', at: h.checkedAt, detail: h.detail })),
    ...smoke.filter((s) => s.outcome !== 'PASS').map((s) => ({ source: `smoke (${s.outcome})`, at: s.checkedAt, detail: s.url })),
    ...deployments.filter((d) => d.status === 'FAILED').map((d) => ({ source: 'deployment', at: d.createdAt, detail: `Deployment v${d.version} failed` })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10);

  return {
    project,
    deployments,
    current,
    health,
    smoke,
    errors,
    features,
    issues,
    reviews,
    openTickets: tickets,
    conversations,
    checkpoints,
    accessLog,
    inventory: buildInventory(source.files),
    lastFileChange: source.newestChange,
  };
}

/** Records that an admin opened a project. Never throws. */
export async function recordProjectAccess(entry: {
  adminId: string;
  adminEmail: string | null;
  projectId: string;
  action?: string;
  ipAddress?: string | null;
}) {
  try {
    await prisma.adminAccessLog.create({
      data: {
        adminId: entry.adminId,
        adminEmail: entry.adminEmail,
        projectId: entry.projectId,
        action: entry.action ?? 'observatory.open_project',
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to record admin access log:', error);
  }
}
