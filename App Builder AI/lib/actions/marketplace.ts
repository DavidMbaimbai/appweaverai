'use server';

import { revalidatePath } from 'next/cache';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { getCachedSession } from '@/lib/auth/cached';
import { listInstallTargets } from '@/lib/marketplace/catalog';
import { installAsset, type InstallResult } from '@/lib/marketplace/install';
import { reportAsset } from '@/lib/marketplace/moderate';
import { startCheckout } from '@/lib/marketplace/purchase';
import { submitReview } from '@/lib/marketplace/reviews';
import { becomeCreator, submitAsset, parseTags, type SubmitResult } from '@/lib/marketplace/submit';
import { ASSET_TYPES, type AssetType } from '@/lib/marketplace/types';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';

type Failure = { error: string };

async function authorize(bucket: string, limit: number, windowMs = 60_000): Promise<{ userId: string } | Failure> {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { error: 'You must be signed in.' };
  const result = await rateLimit(`marketplace:${bucket}:${userId}`, limit, windowMs);
  if (!result.ok) return { error: 'Too many requests. Try again shortly.' };
  return { userId };
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

export async function listInstallTargetsAction() {
  const auth = await authorize('targets', 30);
  if ('error' in auth) return auth;
  return { projects: await listInstallTargets(auth.userId) };
}

export async function installAssetAction(input: {
  slug: string;
  projectId: string;
  artifactSlug: string;
  targetDir: string;
  strategy: 'abort' | 'skip';
  dryRun: boolean;
}): Promise<InstallResult> {
  const auth = await authorize('install', 20);
  if ('error' in auth) return { status: 'error', error: auth.error };
  const result = await installAsset({
    userId: auth.userId,
    projectId: text(input.projectId, 100),
    slug: text(input.slug, 80),
    artifactSlug: text(input.artifactSlug, 128),
    targetDir: text(input.targetDir, 200),
    strategy: input.strategy === 'skip' ? 'skip' : 'abort',
    dryRun: input.dryRun !== false,
  });
  if (result.status === 'installed') revalidatePath(`/marketplace`, 'layout');
  return result;
}

export async function becomeCreatorAction(displayName: string, acceptedTerms: boolean): Promise<{ ok: true } | Failure> {
  const auth = await authorize('creator', 10);
  if ('error' in auth) return auth;
  const result = await becomeCreator(auth.userId, text(displayName, 80), acceptedTerms === true);
  if (!result.ok) return { error: result.error };
  await recordUserActivity({ userId: auth.userId, action: 'marketplace.creator_created', targetType: 'MarketplaceCreator', targetId: result.creator.id });
  revalidatePath('/marketplace/creator');
  return { ok: true };
}

export async function submitAssetAction(input: {
  assetId?: string;
  type: string;
  title: string;
  summary: string;
  description: string;
  tags: string;
  license: string;
  priceCents: number;
  bundleJson: string;
  changelog?: string;
}): Promise<SubmitResult | Failure> {
  const auth = await authorize('submit', 10, 60 * 60_000);
  if ('error' in auth) return auth;
  if (!(ASSET_TYPES as readonly string[]).includes(input.type)) return { error: 'Choose an asset type.' };
  const result = await submitAsset({
    userId: auth.userId,
    assetId: input.assetId ? text(input.assetId, 100) : undefined,
    input: {
      type: input.type as AssetType,
      title: text(input.title, 200),
      summary: text(input.summary, 500),
      description: text(input.description, 10_000),
      tags: parseTags(text(input.tags, 400)),
      license: text(input.license, 50),
      priceCents: Number.isInteger(input.priceCents) ? input.priceCents : 0,
      bundleJson: typeof input.bundleJson === 'string' ? input.bundleJson : '',
      changelog: text(input.changelog, 500),
    },
  });
  if (result.ok) {
    await recordUserActivity({ userId: auth.userId, action: 'marketplace.submitted', targetType: 'MarketplaceAsset', targetId: result.assetId, after: { version: result.version } });
    revalidatePath('/marketplace/creator');
    revalidatePath('/admin/marketplace');
  } else {
    await recordUserActivity({ userId: auth.userId, action: 'marketplace.submission_rejected', targetType: 'MarketplaceAsset', after: { error: result.error } });
  }
  return result;
}

export async function startCheckoutAction(slug: string): Promise<{ url: string } | Failure> {
  const auth = await authorize('checkout', 10);
  if ('error' in auth) return auth;
  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
  const result = await startCheckout({ userId: auth.userId, email: user?.email ?? null, slug: text(slug, 80) });
  if (!result.ok) return { error: result.error };
  await recordUserActivity({ userId: auth.userId, action: 'marketplace.checkout_started', targetType: 'MarketplaceAsset', after: { slug } });
  return { url: result.url };
}

export async function submitReviewAction(slug: string, rating: number, body: string): Promise<{ ok: true } | Failure> {
  const auth = await authorize('review', 10);
  if ('error' in auth) return auth;
  const result = await submitReview({ userId: auth.userId, slug: text(slug, 80), rating, body: text(body, 3000) });
  if (!result.ok) return { error: result.error };
  await recordUserActivity({ userId: auth.userId, action: 'marketplace.reviewed', targetType: 'MarketplaceAsset', after: { slug, rating } });
  revalidatePath('/marketplace', 'layout');
  return { ok: true };
}

export async function reportAssetAction(slug: string, reason: string, details: string): Promise<{ ok: true } | Failure> {
  const auth = await authorize('report', 5, 60 * 60_000);
  if ('error' in auth) return auth;
  const result = await reportAsset({ userId: auth.userId, slug: text(slug, 80), reason: text(reason, 30), details: text(details, 3000) });
  if (!result.ok) return { error: result.error };
  await recordUserActivity({ userId: auth.userId, action: 'marketplace.reported', targetType: 'MarketplaceAsset', after: { slug, reason } });
  revalidatePath('/admin/marketplace');
  return { ok: true };
}
