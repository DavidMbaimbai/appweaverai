import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { INTEGRATIONS } from '@/lib/integrations/catalogue';
import { prisma } from '@/lib/prisma';

import { validateBundle } from './bundle';
import { maxSubmissionsPerDay, salesState } from './config';
import { scanBundle } from './scan';
import { ASSET_TYPES, LICENSE_KEYS, LIMITS } from './types';

export const KNOWN_INTEGRATION_IDS: ReadonlySet<string> = new Set(
  INTEGRATIONS.filter((def) => def.status === 'available').map((def) => def.id),
);

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const metadataSchema = z.object({
  type: z.enum(ASSET_TYPES),
  title: z.string().trim().min(LIMITS.titleMin).max(LIMITS.titleMax),
  summary: z.string().trim().min(10).max(LIMITS.summaryMax),
  description: z.string().trim().min(20).max(LIMITS.descriptionMax),
  tags: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9 -]*$/).max(LIMITS.maxTagLength)).max(LIMITS.maxTags),
  license: z.string().refine((value) => LICENSE_KEYS.includes(value), 'Choose a licence from the list.'),
  priceCents: z.number().int().min(0).max(LIMITS.maxPriceCents),
});

export type SubmitInput = z.input<typeof metadataSchema> & { bundleJson: string; changelog?: string };

export type SubmitResult =
  | { ok: true; assetId: string; slug: string; version: number }
  | { ok: false; error: string; findings?: Array<{ title: string; file: string; severity: string }> };

export function parseTags(raw: string) {
  return Array.from(new Set(raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)));
}

export async function getCreator(userId: string) {
  return prisma.marketplaceCreator.findUnique({ where: { userId } });
}

export async function becomeCreator(userId: string, displayName: string, acceptedTerms: boolean) {
  const name = displayName.trim();
  if (name.length < 2 || name.length > 60) return { ok: false as const, error: 'Display name must be 2-60 characters.' };
  if (!acceptedTerms) return { ok: false as const, error: 'Accept the creator terms to publish.' };
  const existing = await getCreator(userId);
  if (existing) return { ok: true as const, creator: existing };
  const base = slugify(name) || 'creator';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const creator = await prisma.marketplaceCreator.create({
        data: { userId, displayName: name, slug: attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`, termsAcceptedAt: new Date() },
      });
      return { ok: true as const, creator };
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const raced = await getCreator(userId);
      if (raced) return { ok: true as const, creator: raced };
    }
  }
  return { ok: false as const, error: 'Could not create your creator profile. Try a different name.' };
}

async function uniqueSlug(title: string) {
  const base = slugify(title) || 'asset';
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 52)}-${randomBytes(2).toString('hex')}`;
    if (!(await prisma.marketplaceAsset.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base.slice(0, 48)}-${randomBytes(4).toString('hex')}`;
}

async function checkCreatorLimits(creatorId: string) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [today, pending, total] = await Promise.all([
    prisma.marketplaceAssetVersion.count({ where: { asset: { creatorId }, createdAt: { gte: dayAgo } } }),
    prisma.marketplaceAssetVersion.count({ where: { asset: { creatorId }, status: 'PENDING_REVIEW' } }),
    prisma.marketplaceAsset.count({ where: { creatorId } }),
  ]);
  const perDay = maxSubmissionsPerDay();
  if (today >= perDay) return `Submission limit reached (${perDay} per 24 hours). Try again later.`;
  if (pending >= LIMITS.maxPendingPerCreator) return 'You have too many submissions waiting for review.';
  if (total >= LIMITS.maxAssetsPerCreator) return 'Asset limit reached for this creator.';
  return null;
}

/**
 * Creates a new asset (or a new version of the creator's own asset) in PENDING_REVIEW after validating the bundle
 * and running the safety scan. A scan that finds secrets or dangerous code rejects the submission outright.
 */
export async function submitAsset(args: { userId: string; assetId?: string; input: SubmitInput }): Promise<SubmitResult> {
  const creator = await getCreator(args.userId);
  if (!creator) return { ok: false, error: 'Create a creator profile first.' };

  const limit = await checkCreatorLimits(creator.id);
  if (limit) return { ok: false, error: limit };

  const parsedMeta = metadataSchema.safeParse(args.input);
  if (!parsedMeta.success) return { ok: false, error: parsedMeta.error.issues[0]?.message ?? 'Invalid asset details.' };
  const meta = parsedMeta.data;

  if (meta.priceCents > 0) {
    const sales = salesState();
    if (!sales.enabled) return { ok: false, error: sales.reason };
    if (meta.priceCents < LIMITS.minPriceCents) return { ok: false, error: `Paid assets start at ${LIMITS.minPriceCents} cents.` };
  }

  if (typeof args.input.bundleJson !== 'string' || args.input.bundleJson.length > LIMITS.maxBundleBytes * 2) {
    return { ok: false, error: 'Bundle is too large.' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(args.input.bundleJson);
  } catch {
    return { ok: false, error: 'Bundle must be valid JSON.' };
  }
  const validation = validateBundle(raw, meta.type, KNOWN_INTEGRATION_IDS);
  if (!validation.ok) return { ok: false, error: `Bundle rejected: ${validation.errors.join(' ')}` };

  const scan = await scanBundle(validation.bundle);
  if (scan.verdict === 'blocked') {
    return {
      ok: false,
      error: 'The safety scan blocked this bundle. Remove secrets and dangerous code, then submit again.',
      findings: scan.findings
        .filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH' || f.rule.startsWith('secret/'))
        .slice(0, 10)
        .map((f) => ({ title: f.title, file: f.file, severity: f.severity })),
    };
  }

  const changelog = args.input.changelog?.trim().slice(0, 500) || null;
  const versionData = {
    changelog,
    bundle: validation.bundle as unknown as object,
    checksum: validation.checksum,
    sizeBytes: validation.sizeBytes,
    fileCount: validation.fileCount,
    status: 'PENDING_REVIEW' as const,
    scanVerdict: scan.verdict,
    scanFindings: scan.findings as unknown as object[],
  };

  if (args.assetId) {
    const asset = await prisma.marketplaceAsset.findFirst({
      where: { id: args.assetId, creatorId: creator.id, status: { not: 'REMOVED' } },
      select: { id: true, slug: true, type: true, status: true },
    });
    if (!asset) return { ok: false, error: 'Asset not found.' };
    if (asset.type !== meta.type) return { ok: false, error: 'The asset type cannot change between versions.' };
    const last = await prisma.marketplaceAssetVersion.findFirst({ where: { assetId: asset.id }, orderBy: { version: 'desc' }, select: { version: true, checksum: true } });
    if (last?.checksum === validation.checksum) return { ok: false, error: 'This content is identical to your latest version.' };
    const version = (last?.version ?? 0) + 1;
    await prisma.$transaction([
      prisma.marketplaceAssetVersion.create({ data: { assetId: asset.id, version, ...versionData } }),
      ...(asset.status === 'PUBLISHED' ? [] : [prisma.marketplaceAsset.update({ where: { id: asset.id }, data: { status: 'PENDING_REVIEW', statusReason: null } })]),
    ]);
    return { ok: true, assetId: asset.id, slug: asset.slug, version };
  }

  const slug = await uniqueSlug(meta.title);
  const created = await prisma.marketplaceAsset.create({
    data: {
      creatorId: creator.id,
      type: meta.type,
      slug,
      title: meta.title,
      summary: meta.summary,
      description: meta.description,
      tags: meta.tags,
      license: meta.license,
      priceCents: meta.priceCents,
      currency: 'usd',
      status: 'PENDING_REVIEW',
      versions: { create: { version: 1, ...versionData } },
    },
    select: { id: true, slug: true },
  });
  return { ok: true, assetId: created.id, slug: created.slug, version: 1 };
}

/** Creator's own assets, newest first, with the latest version's scan result. Scoped to the creator's user. */
export async function listCreatorAssets(userId: string) {
  const creator = await getCreator(userId);
  if (!creator) return { creator: null, assets: [], balanceCents: 0 };
  const [assets, ledger] = await Promise.all([
    prisma.marketplaceAsset.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, status: true, scanVerdict: true, reviewNotes: true } },
        _count: { select: { installs: true, orders: true } },
      },
    }),
    prisma.marketplacePayoutLedger.aggregate({ where: { creatorId: creator.id }, _sum: { amountCents: true } }),
  ]);
  return { creator, assets, balanceCents: ledger._sum.amountCents ?? 0 };
}
