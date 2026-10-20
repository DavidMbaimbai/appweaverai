import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';

import { installFilesOf, type Bundle } from './bundle';
import type { AssetType } from './types';

export const PAGE_SIZE = 24;

export const SORTS = ['newest', 'popular', 'price_asc', 'price_desc', 'title'] as const;
export type Sort = (typeof SORTS)[number];

export type BrowseParams = {
  q?: string;
  type?: AssetType;
  tag?: string;
  price?: 'free' | 'paid';
  sort?: Sort;
  page?: number;
};

export type AssetCard = {
  id: string;
  slug: string;
  type: AssetType;
  title: string;
  summary: string;
  tags: string[];
  priceCents: number;
  currency: string;
  license: string;
  isFirstParty: boolean;
  creatorName: string;
  installCount: number;
  reviewCount: number;
  averageRating: number | null;
  publishedAt: Date | null;
};

type CardRow = Prisma.MarketplaceAssetGetPayload<{
  include: { creator: { select: { displayName: true; slug: true } }; _count: { select: { installs: true } } };
}>;

/** Real aggregates only: ratings and counts come from stored reviews and installs, never from seeds. */
async function ratingsFor(assetIds: string[]) {
  if (assetIds.length === 0) return new Map<string, { count: number; average: number | null }>();
  const grouped = await prisma.marketplaceReview.groupBy({
    by: ['assetId'],
    where: { assetId: { in: assetIds }, hidden: false },
    _count: { _all: true },
    _avg: { rating: true },
  });
  return new Map(grouped.map((g) => [g.assetId, { count: g._count._all, average: g._avg.rating }]));
}

function toCard(row: CardRow, ratings: Map<string, { count: number; average: number | null }>): AssetCard {
  const rating = ratings.get(row.id);
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    summary: row.summary,
    tags: row.tags,
    priceCents: row.priceCents,
    currency: row.currency,
    license: row.license,
    isFirstParty: row.isFirstParty,
    creatorName: row.isFirstParty ? 'AppWeaver' : (row.creator?.displayName ?? 'Unknown creator'),
    installCount: row._count.installs,
    reviewCount: rating?.count ?? 0,
    averageRating: rating?.average ?? null,
    publishedAt: row.publishedAt,
  };
}

const CARD_INCLUDE = {
  creator: { select: { displayName: true, slug: true } },
  _count: { select: { installs: true } },
} as const;

/** Public browse: only PUBLISHED assets are ever returned. */
export async function browseAssets(params: BrowseParams) {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const q = params.q?.trim().slice(0, 80);
  const where: Prisma.MarketplaceAssetWhereInput = {
    status: 'PUBLISHED',
    ...(params.type ? { type: params.type } : {}),
    ...(params.tag ? { tags: { has: params.tag.toLowerCase().slice(0, 24) } } : {}),
    ...(params.price === 'free' ? { priceCents: 0 } : params.price === 'paid' ? { priceCents: { gt: 0 } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { summary: { contains: q, mode: 'insensitive' } },
            { tags: { has: q.toLowerCase() } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.MarketplaceAssetOrderByWithRelationInput[] =
    params.sort === 'popular'
      ? [{ installs: { _count: 'desc' } }, { publishedAt: 'desc' }]
      : params.sort === 'price_asc'
        ? [{ priceCents: 'asc' }, { title: 'asc' }]
        : params.sort === 'price_desc'
          ? [{ priceCents: 'desc' }, { title: 'asc' }]
          : params.sort === 'title'
            ? [{ title: 'asc' }]
            : [{ publishedAt: 'desc' }, { id: 'asc' }];

  const [total, rows] = await Promise.all([
    prisma.marketplaceAsset.count({ where }),
    prisma.marketplaceAsset.findMany({ where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: CARD_INCLUDE }),
  ]);
  const ratings = await ratingsFor(rows.map((r) => r.id));
  return { items: rows.map((r) => toCard(r, ratings)), total, page, pageSize: PAGE_SIZE };
}

export async function listPublishedSlugs(limit = 500) {
  return prisma.marketplaceAsset.findMany({
    where: { status: 'PUBLISHED' },
    select: { slug: true, type: true, updatedAt: true },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
}

export type AssetDetail = AssetCard & {
  description: string;
  currentVersion: number;
  versions: Array<{ version: number; createdAt: Date; changelog: string | null; checksum: string; fileCount: number; sizeBytes: number }>;
  files: Array<{ path: string; bytes: number; preview: string }>;
  integrationId: string | null;
  workflowSteps: number | null;
  reviews: Array<{ id: string; rating: number; body: string; createdAt: Date }>;
  scanVerdict: string;
  statusReason: string | null;
};

const PREVIEW_CHARS = 600;

/** Public detail view of a PUBLISHED asset. Returns null for anything else (drafts, pending, removed). */
export async function getPublishedAsset(slug: string): Promise<AssetDetail | null> {
  const row = await prisma.marketplaceAsset.findFirst({
    where: { slug, status: 'PUBLISHED', publishedVersion: { not: null } },
    include: {
      ...CARD_INCLUDE,
      versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 20 },
      reviews: { where: { hidden: false }, orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!row) return null;
  const current = row.versions.find((v) => v.version === row.publishedVersion);
  if (!current) return null;
  const ratings = await ratingsFor([row.id]);
  const bundle = current.bundle as unknown as Bundle;
  const files = installFilesOf(bundle).map((f) => ({
    path: f.path,
    bytes: Buffer.byteLength(f.content),
    preview: f.content.slice(0, PREVIEW_CHARS),
  }));
  return {
    ...toCard(row, ratings),
    description: row.description,
    currentVersion: current.version,
    versions: row.versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt,
      changelog: v.changelog,
      checksum: v.checksum,
      fileCount: v.fileCount,
      sizeBytes: v.sizeBytes,
    })),
    files,
    integrationId: bundle.integrationId ?? null,
    workflowSteps: bundle.workflow?.steps.length ?? null,
    reviews: row.reviews.map((r) => ({ id: r.id, rating: r.rating, body: r.body, createdAt: r.createdAt })),
    scanVerdict: current.scanVerdict,
    statusReason: row.statusReason,
  };
}

/** Which of the caller's relationships to an asset unlock actions. Always scoped by userId. */
export async function getViewerState(userId: string, assetId: string) {
  const [asset, install, order, review] = await Promise.all([
    prisma.marketplaceAsset.findUnique({ where: { id: assetId }, select: { creator: { select: { userId: true } } } }),
    prisma.marketplaceInstall.findFirst({ where: { userId, assetId }, select: { id: true } }),
    prisma.marketplaceOrder.findFirst({ where: { userId, assetId, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } }, select: { id: true } }),
    prisma.marketplaceReview.findUnique({ where: { assetId_userId: { assetId, userId } }, select: { id: true } }),
  ]);
  return {
    isCreator: asset?.creator?.userId === userId,
    hasInstall: Boolean(install),
    hasPaidOrder: Boolean(order),
    alreadyReviewed: Boolean(review),
  };
}

/** Projects the user can install into, with their artifacts. Scoped by project access. */
export async function listInstallTargets(userId: string) {
  const projects = await prisma.project.findMany({
    where: projectAccessWhere(userId),
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, name: true, artifacts: { orderBy: { sortOrder: 'asc' }, select: { slug: true, name: true } } },
  });
  return projects.filter((p) => p.artifacts.length > 0);
}
