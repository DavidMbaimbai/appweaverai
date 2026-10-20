import { prisma } from '@/lib/prisma';

import { getViewerState } from './catalog';
import { reviewEligibility } from './rules';
import { LIMITS, type AssetStatus } from './types';

type Result = { ok: true } | { ok: false; error: string };

/** Verified installers or purchasers only, one review per user (also enforced by a unique index). */
export async function submitReview(args: { userId: string; slug: string; rating: number; body: string }): Promise<Result> {
  if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) return { ok: false, error: 'Choose a rating from 1 to 5.' };
  const body = args.body.trim();
  if (body.length < 10 || body.length > LIMITS.reviewMax) return { ok: false, error: `Write 10-${LIMITS.reviewMax} characters.` };

  const asset = await prisma.marketplaceAsset.findUnique({ where: { slug: args.slug }, select: { id: true, status: true } });
  if (!asset) return { ok: false, error: 'Asset not found.' };
  const viewer = await getViewerState(args.userId, asset.id);
  const eligibility = reviewEligibility({ ...viewer, assetStatus: asset.status as AssetStatus });
  if (!eligibility.ok) return { ok: false, error: eligibility.reason };

  try {
    await prisma.marketplaceReview.create({ data: { assetId: asset.id, userId: args.userId, rating: args.rating, body } });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return { ok: false, error: 'You have already reviewed this asset.' };
    throw error;
  }
  return { ok: true };
}
