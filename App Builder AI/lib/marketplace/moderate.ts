import { prisma } from '@/lib/prisma';
import { recordAuditLog } from '@/lib/admin/audit';

import { moderationDecision, type ModerationAction } from './rules';
import { LIMITS, REPORT_REASONS, type AssetStatus } from './types';

type Actor = { id: string; email?: string | null };
type Result = { ok: true } | { ok: false; error: string };

export async function listModerationQueue() {
  const [pending, reports, removed] = await Promise.all([
    prisma.marketplaceAssetVersion.findMany({
      where: { status: 'PENDING_REVIEW', asset: { status: { not: 'REMOVED' } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        version: true,
        createdAt: true,
        scanVerdict: true,
        scanFindings: true,
        fileCount: true,
        sizeBytes: true,
        changelog: true,
        asset: { select: { id: true, slug: true, title: true, type: true, summary: true, priceCents: true, license: true, creator: { select: { displayName: true } } } },
      },
    }),
    prisma.marketplaceReport.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, reason: true, details: true, createdAt: true, asset: { select: { id: true, slug: true, title: true, status: true } } },
    }),
    prisma.marketplaceAsset.count({ where: { status: 'REMOVED' } }),
  ]);
  return { pending, reports, removed };
}

/** Approve / reject a pending version, or take down / restore an asset. Every decision is audit-logged. */
export async function moderateVersion(args: { actor: Actor; action: ModerationAction; versionId: string; reason?: string }): Promise<Result> {
  const version = await prisma.marketplaceAssetVersion.findUnique({
    where: { id: args.versionId },
    select: { id: true, version: true, status: true, scanVerdict: true, asset: { select: { id: true, slug: true, status: true, publishedVersion: true } } },
  });
  if (!version) return { ok: false, error: 'Submission not found.' };
  if (version.asset.status === 'REMOVED' && (args.action === 'approve' || args.action === 'reject')) {
    return { ok: false, error: 'This asset was taken down. Restore it before reviewing submissions.' };
  }

  const gating = moderationDecision({
    action: args.action,
    versionStatus: args.action === 'remove' || args.action === 'restore' ? (version.asset.status as AssetStatus) : (version.status as AssetStatus),
    scanVerdict: version.scanVerdict,
    reason: args.reason,
  });
  if (!gating.ok) return gating;

  const now = new Date();
  const reason = args.reason?.trim().slice(0, 500) || null;
  const assetId = version.asset.id;

  if (args.action === 'approve') {
    await prisma.$transaction([
      prisma.marketplaceAssetVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED', reviewNotes: reason } }),
      prisma.marketplaceAsset.update({
        where: { id: assetId },
        data: { status: 'PUBLISHED', publishedVersion: version.version, publishedAt: version.asset.publishedVersion ? undefined : now, reviewedById: args.actor.id, reviewedAt: now, statusReason: null },
      }),
    ]);
  } else if (args.action === 'reject') {
    await prisma.$transaction([
      prisma.marketplaceAssetVersion.update({ where: { id: version.id }, data: { status: 'REJECTED', reviewNotes: reason } }),
      ...(version.asset.publishedVersion === null
        ? [prisma.marketplaceAsset.update({ where: { id: assetId }, data: { status: 'REJECTED', statusReason: reason, reviewedById: args.actor.id, reviewedAt: now } })]
        : []),
    ]);
  } else if (args.action === 'remove') {
    await prisma.$transaction([
      prisma.marketplaceAsset.update({ where: { id: assetId }, data: { status: 'REMOVED', statusReason: reason, reviewedById: args.actor.id, reviewedAt: now } }),
      prisma.marketplaceReport.updateMany({ where: { assetId, status: 'OPEN' }, data: { status: 'ACTIONED', resolvedById: args.actor.id, resolvedAt: now } }),
    ]);
  } else {
    await prisma.marketplaceAsset.update({
      where: { id: assetId },
      data: { status: version.asset.publishedVersion === null ? 'PENDING_REVIEW' : 'PUBLISHED', statusReason: null, reviewedById: args.actor.id, reviewedAt: now },
    });
  }

  await recordAuditLog({
    adminId: args.actor.id,
    adminEmail: args.actor.email ?? null,
    action: `marketplace.${args.action}`,
    targetType: 'MarketplaceAsset',
    targetId: assetId,
    after: { versionId: version.id, version: version.version, slug: version.asset.slug },
    reason,
  });
  return { ok: true };
}

/** Takedown by asset id (from a report). Reuses the same gating and audit trail. */
export async function takedownAsset(args: { actor: Actor; assetId: string; reason: string }): Promise<Result> {
  const latest = await prisma.marketplaceAssetVersion.findFirst({ where: { assetId: args.assetId }, orderBy: { version: 'desc' }, select: { id: true } });
  if (!latest) return { ok: false, error: 'Asset not found.' };
  return moderateVersion({ actor: args.actor, action: 'remove', versionId: latest.id, reason: args.reason });
}

export async function dismissReport(args: { actor: Actor; reportId: string }): Promise<Result> {
  const updated = await prisma.marketplaceReport.updateMany({
    where: { id: args.reportId, status: 'OPEN' },
    data: { status: 'DISMISSED', resolvedById: args.actor.id, resolvedAt: new Date() },
  });
  if (updated.count === 0) return { ok: false, error: 'Report not found or already resolved.' };
  await recordAuditLog({ adminId: args.actor.id, adminEmail: args.actor.email ?? null, action: 'marketplace.report_dismissed', targetType: 'MarketplaceReport', targetId: args.reportId });
  return { ok: true };
}

/** Anyone signed in can report; one report per user per asset. Only published assets can be reported. */
export async function reportAsset(args: { userId: string; slug: string; reason: string; details: string }): Promise<Result> {
  if (!(REPORT_REASONS as readonly string[]).includes(args.reason)) return { ok: false, error: 'Choose a reason.' };
  const details = args.details.trim();
  if (details.length < 10 || details.length > LIMITS.reportMax) return { ok: false, error: `Describe the problem (10-${LIMITS.reportMax} characters).` };
  const asset = await prisma.marketplaceAsset.findFirst({ where: { slug: args.slug, status: 'PUBLISHED' }, select: { id: true } });
  if (!asset) return { ok: false, error: 'Asset not found.' };
  try {
    await prisma.marketplaceReport.create({ data: { assetId: asset.id, reporterId: args.userId, reason: args.reason, details } });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return { ok: false, error: 'You have already reported this asset.' };
    throw error;
  }
  return { ok: true };
}
