'use server';

import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/require-user';
import { prisma } from '@/lib/prisma';
import { isSafePublicUrl } from '@/lib/outreach/compliance';
import { parseMediaRef } from '@/lib/media-hosting/logic';
import { getAccessibleProject } from '@/lib/projects/access';
import { isValidTimeZone } from '@/lib/ads/schedule';
import { generateCampaignPosts } from '@/lib/project-marketing/generate';
import {
  approvedStatus,
  isAutoPublishPlatform,
  isPlatform,
  normalizeHashtags,
  resolveSchedule,
  validatePostText,
} from '@/lib/project-marketing/logic';
import { syncCampaignStatus } from '@/lib/project-marketing/publish';
import { connectionPlatform, hasInstagramImage, INSTAGRAM_NEEDS_IMAGE } from '@/lib/project-marketing/instagram';
import { PAGE_CHOICE_COOKIE, unpackPageChoices } from '@/lib/project-marketing/pages';
import { encryptSecret } from '@/lib/crypto/secret-box';
import { cookies } from 'next/headers';
import { rateLimit } from '@/lib/rate-limit';
import { withMarketingCredits } from '@/lib/marketing-credits/run';

type Result = { ok: true; message?: string } | { ok: false; error: string };

const MAX_BRIEF = 1500;
const LOCKED = ['PUBLISHING', 'PUBLISHED'];

async function currentUser() {
  const auth = await requireUserId();
  return auth.error || !auth.userId ? null : auth.userId;
}

async function loadOwnedPost(userId: string, postId: string) {
  const post = await prisma.projectPost.findUnique({
    where: { id: postId },
    include: { campaign: { select: { id: true, userId: true, projectId: true } } },
  });
  if (!post || post.campaign.userId !== userId) return null;
  const project = await getAccessibleProject(post.campaign.projectId, userId, { id: true });
  return project ? post : null;
}

async function projectUrl(projectId: string) {
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, isCurrent: true, status: 'LIVE' },
    select: { domain: true, customDomain: true },
  });
  const host = deployment?.customDomain || deployment?.domain;
  return host ? `https://${host}` : null;
}

export async function generateCampaignAction(
  projectId: string,
  brief: string,
  timeZone: string,
): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const text = typeof brief === 'string' ? brief.trim() : '';
  if (text.length > MAX_BRIEF) return { ok: false, error: 'Brief is too long.' };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: 'Invalid time zone.' };

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    name: true,
    description: true,
    brandKit: { select: { primaryColor: true, fontFamily: true } },
  });
  if (!project) return { ok: false, error: 'Project not found.' };

  const limit = await rateLimit(`project-campaign:${userId}`, 6, 60 * 60 * 1000);
  if (!limit.ok) return { ok: false, error: `Hourly limit reached. Try again in ${limit.retryAfter}s.` };

  const charged = await withMarketingCredits(
    {
      userId,
      projectId: project.id,
      operation: 'campaign_draft',
      refType: 'Project',
      refId: project.id,
      isFailure: (r: Result) => !r.ok,
    },
    async (): Promise<Result> => {
      try {
        const url = await projectUrl(project.id);
        const result = await generateCampaignPosts(
          { name: project.name, description: project.description, url, brandKit: project.brandKit },
          text,
          timeZone,
        );
        if (!result) return { ok: false, error: 'Could not produce a safe campaign. Add more detail and try again.' };

        await prisma.projectCampaign.create({
          data: {
            projectId: project.id,
            userId,
            name: result.name,
            brief: text,
            posts: {
              create: result.posts.map((p) => ({
                platform: p.platform,
                text: p.text,
                hashtags: p.hashtags,
                scheduledAt: p.scheduledAt,
                timeZone,
              })),
            },
          },
        });
        revalidatePath('/app/projects');
        return { ok: true, message: 'Campaign drafted. Review, edit and approve each post.' };
      } catch (error) {
        console.error('[project-marketing] generate failed:', error);
        return { ok: false, error: 'Generation failed. Please try again.' };
      }
    },
  );
  return charged.ok ? charged.value : { ok: false, error: charged.error };
}

/** Editing text always withdraws approval, so approved copy is exactly what was reviewed. */
export async function savePostAction(
  postId: string,
  input: { text: string; hashtags: string; imageUrl: string },
): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const post = await loadOwnedPost(userId, postId);
  if (!post) return { ok: false, error: 'Post not found.' };
  if (LOCKED.includes(post.status)) return { ok: false, error: 'This post can no longer be edited.' };

  const hashtags = normalizeHashtags(input.hashtags);
  const invalid = validatePostText(post.platform, String(input.text ?? ''), hashtags);
  if (invalid) return { ok: false, error: invalid };
  const imageUrl = input.imageUrl?.trim() || null;
  const mediaId = parseMediaRef(imageUrl);
  if (mediaId) {
    // A hosted image may only be kept if it belongs to this project.
    const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, scopeKey: post.campaign.projectId, status: 'READY' }, select: { id: true } });
    if (!asset) return { ok: false, error: 'That hosted image is not available for this project.' };
  } else if (imageUrl && !isSafePublicUrl(imageUrl)) {
    return { ok: false, error: 'Image must be a public https URL.' };
  }

  await prisma.projectPost.update({
    where: { id: post.id },
    data: { text: input.text.trim(), hashtags, imageUrl, status: 'DRAFT', error: null },
  });
  await syncCampaignStatus(post.campaignId);
  return { ok: true, message: 'Saved as draft. Approve it to schedule.' };
}

/** Explicit owner approval; `local` is "YYYY-MM-DDTHH:mm" in `timeZone`. */
export async function approvePostAction(postId: string, local: string, timeZone: string): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const post = await loadOwnedPost(userId, postId);
  if (!post) return { ok: false, error: 'Post not found.' };
  if (LOCKED.includes(post.status)) return { ok: false, error: 'This post is already published.' };

  const invalid = validatePostText(post.platform, post.text, post.hashtags);
  if (invalid) return { ok: false, error: invalid };

  const schedule = resolveSchedule(local, timeZone);
  if (!schedule.ok) return schedule;

  const connected = isAutoPublishPlatform(post.platform)
    ? Boolean(
        await prisma.socialConnection.findUnique({
          where: { userId_platform: { userId, platform: connectionPlatform(post.platform) as 'X' | 'LINKEDIN' | 'FACEBOOK' } },
          select: { id: true },
        }),
      )
    : false;
  const status = approvedStatus(post.platform, connected, post.imageUrl);
  const manualReason =
    post.platform === 'INSTAGRAM' && !hasInstagramImage(post.imageUrl)
      ? INSTAGRAM_NEEDS_IMAGE
      : 'No connected account. Copy this post and publish it yourself.';

  await prisma.projectPost.update({
    where: { id: post.id },
    data: {
      status,
      scheduledAt: schedule.at,
      timeZone,
      error: status === 'MANUAL' ? manualReason : null,
    },
  });
  await syncCampaignStatus(post.campaignId);
  return {
    ok: true,
    message: status === 'MANUAL' ? 'Approved for manual posting.' : 'Approved and scheduled.',
  };
}

export async function unapprovePostAction(postId: string): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const post = await loadOwnedPost(userId, postId);
  if (!post) return { ok: false, error: 'Post not found.' };
  if (LOCKED.includes(post.status)) return { ok: false, error: 'This post is already published.' };
  await prisma.projectPost.update({ where: { id: post.id }, data: { status: 'DRAFT', error: null } });
  await syncCampaignStatus(post.campaignId);
  return { ok: true };
}

export async function markPostedManuallyAction(postId: string): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const post = await loadOwnedPost(userId, postId);
  if (!post || post.status !== 'MANUAL') return { ok: false, error: 'Post not found.' };
  await prisma.projectPost.update({
    where: { id: post.id },
    data: { status: 'PUBLISHED', publishedAt: new Date(), error: null },
  });
  await syncCampaignStatus(post.campaignId);
  return { ok: true };
}

export async function deletePostAction(postId: string): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const post = await loadOwnedPost(userId, postId);
  if (!post) return { ok: false, error: 'Post not found.' };
  if (post.status === 'PUBLISHING') return { ok: false, error: 'This post is being published.' };
  await prisma.projectPost.delete({ where: { id: post.id } });
  await syncCampaignStatus(post.campaignId);
  return { ok: true };
}

export async function selectFacebookPageAction(pageId: string): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const jar = await cookies();
  const page = unpackPageChoices(jar.get(PAGE_CHOICE_COOKIE)?.value).find((p) => p.id === pageId);
  if (!page) return { ok: false, error: 'That choice expired. Connect Facebook again.' };
  const data = {
    accessTokenEnc: encryptSecret(page.access_token),
    refreshTokenEnc: null,
    expiresAt: null,
    accountName: page.name,
    accountId: page.id,
  };
  await prisma.socialConnection.upsert({
    where: { userId_platform: { userId, platform: 'FACEBOOK' } },
    create: { userId, platform: 'FACEBOOK', ...data },
    update: data,
  });
  jar.delete({ name: PAGE_CHOICE_COOKIE, path: '/app/projects' });
  return { ok: true, message: `Facebook Page connected: ${page.name}.` };
}

export async function disconnectSocialAction(platform: string): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  if (!isPlatform(platform)) return { ok: false, error: 'Unknown platform.' };
  await prisma.socialConnection.deleteMany({ where: { userId, platform } });
  return { ok: true };
}
