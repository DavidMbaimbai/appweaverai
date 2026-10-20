'use server';

import { revalidatePath } from 'next/cache';

import { generateCustomerAdCopy } from '@/lib/ads/copy';
import { listAssets } from '@/lib/ads/customer-oauth';
import { generateAdImage } from '@/lib/ads/image';
import { withMarketingCredits } from '@/lib/marketing-credits/run';
import {
  createAd,
  createAdSet,
  createCampaign,
  setAdStatus,
  uploadImage,
  type MetaCtx,
} from '@/lib/ads/meta';
import { requireUserId } from '@/lib/auth/require-user';
import { decryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';
import { MAX_SCHEDULE_AHEAD_DAYS, zonedTimeToUtc } from '@/lib/ads/schedule';
import { rateLimit } from '@/lib/rate-limit';
import { isSafePublicUrl } from '@/lib/outreach/compliance';

const MIN_DAILY_CENTS = 100;
const MAX_CAP_CENTS = 10_000;
const MAX_DAYS = 14;

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function currentUser() {
  const auth = await requireUserId();
  return auth.error || !auth.userId ? null : auth.userId;
}

async function loadConnection(userId: string) {
  const connection = await prisma.metaAdConnection.findUnique({ where: { userId } });
  if (!connection) return null;
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now()) return null;
  return { connection, token: decryptSecret(connection.accessTokenEnc) };
}

export async function selectMetaAssetsAction(adAccountId: string, pageId: string): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const loaded = await loadConnection(userId);
  if (!loaded) return { ok: false, error: 'Connect Facebook again.' };

  try {
    const assets = await listAssets(loaded.token);
    const account = assets.adAccounts.find((a) => a.id === adAccountId);
    const page = assets.pages.find((p) => p.id === pageId);
    if (!account || !page) return { ok: false, error: 'Choose an ad account and page you own.' };
    await prisma.metaAdConnection.update({
      where: { userId },
      data: {
        adAccountId: account.id,
        adAccountName: account.name,
        currency: account.currency,
        pageId: page.id,
        pageName: page.name,
      },
    });
    revalidatePath('/app/studio');
    return { ok: true };
  } catch (error) {
    console.error('[meta-ads] select failed:', error);
    return { ok: false, error: 'Could not load your Facebook assets.' };
  }
}

export async function setDailyCapAction(cents: number): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  if (!Number.isInteger(cents) || cents < MIN_DAILY_CENTS || cents > MAX_CAP_CENTS) {
    return { ok: false, error: 'Choose a cap between 1.00 and 100.00.' };
  }
  await prisma.metaAdConnection.updateMany({ where: { userId }, data: { dailyCapCents: cents } });
  revalidatePath('/app/studio');
  return { ok: true };
}

export async function disconnectMetaAdsAction(): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const loaded = await loadConnection(userId);
  const running = await prisma.customerAd.findMany({
    where: { userId, status: { in: ['ACTIVE', 'SCHEDULED'] }, endsAt: { gt: new Date() } },
  });
  // Stop spend before the token is deleted.
  if (loaded?.connection.adAccountId && loaded.connection.pageId) {
    const ctx = ctxFor(loaded);
    for (const ad of running) {
      if (ad.metaAdId) await setAdStatus(ad.metaAdId, 'PAUSED', ctx).catch(() => undefined);
    }
  }
  await prisma.customerAd.updateMany({
    where: { userId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
    data: { status: 'PAUSED' },
  });
  await prisma.metaAdConnection.deleteMany({ where: { userId } });
  revalidatePath('/app/studio');
  return { ok: true };
}

function ctxFor(loaded: NonNullable<Awaited<ReturnType<typeof loadConnection>>>): MetaCtx {
  return {
    token: loaded.token,
    accountId: loaded.connection.adAccountId ?? '',
    pageId: loaded.connection.pageId ?? '',
  };
}

export async function launchCustomerAdAction(input: {
  brief: string;
  link: string;
  dailyBudgetCents: number;
  days: number;
  /** Optional local start ("YYYY-MM-DDTHH:mm") in `timeZone`; omitted means start now. */
  startLocal?: string;
  timeZone?: string;
  acknowledge: boolean;
}): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  if (!input.acknowledge) {
    return { ok: false, error: 'Please confirm that Meta will charge your ad account.' };
  }

  const brief = String(input.brief ?? '').trim();
  if (brief.length < 20 || brief.length > 1500) {
    return { ok: false, error: 'Describe your offer in 20 to 1500 characters.' };
  }
  if (!isSafePublicUrl(input.link) || !input.link.startsWith('https://')) {
    return { ok: false, error: 'Enter a public https website link.' };
  }
  const days = Math.floor(input.days);
  if (!(days >= 1 && days <= MAX_DAYS)) return { ok: false, error: `Run for 1 to ${MAX_DAYS} days.` };
  const daily = Math.floor(input.dailyBudgetCents);
  if (!(daily >= MIN_DAILY_CENTS)) return { ok: false, error: 'Daily budget is too low.' };

  const limit = await rateLimit(`customer-ads:${userId}`, 5, 60 * 60 * 1000);
  if (!limit.ok) return { ok: false, error: 'Too many launches. Try again later.' };

  const loaded = await loadConnection(userId);
  if (!loaded) return { ok: false, error: 'Connect Facebook first.' };
  const { connection } = loaded;
  if (!connection.adAccountId || !connection.pageId) {
    return { ok: false, error: 'Choose your ad account and page first.' };
  }

  const now = new Date();
  let startsAt = now;
  if (input.startLocal) {
    const parsed = zonedTimeToUtc(input.startLocal, input.timeZone ?? 'UTC');
    if (!parsed) return { ok: false, error: 'Enter a valid start time and time zone.' };
    if (parsed.getTime() < now.getTime() - 60_000) {
      return { ok: false, error: 'The start time is in the past.' };
    }
    if (parsed.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 24 * 60 * 60 * 1000) {
      return { ok: false, error: `Schedule at most ${MAX_SCHEDULE_AHEAD_DAYS} days ahead.` };
    }
    if (parsed.getTime() > now.getTime() + 60_000) startsAt = parsed;
  }
  const endsAt = new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000);

  // Only ads that overlap this run count against the daily cap.
  const running = await prisma.customerAd.aggregate({
    where: {
      userId,
      status: { in: ['ACTIVE', 'SCHEDULED'] },
      endsAt: { gt: startsAt },
      startsAt: { lt: endsAt },
    },
    _sum: { dailyCents: true },
  });
  const committed = running._sum.dailyCents ?? 0;
  if (committed + daily > connection.dailyCapCents) {
    return {
      ok: false,
      error: `This would exceed your daily cap of ${(connection.dailyCapCents / 100).toFixed(2)} ${connection.currency ?? ''}. ${(committed / 100).toFixed(2)} is already committed.`,
    };
  }

  const charged = await withMarketingCredits(
    { userId, operation: 'customer_ad', refType: 'CustomerAd', isFailure: (r: Result) => !r.ok },
    async (): Promise<Result> => {
      const copy = await generateCustomerAdCopy(brief).catch(() => null);
      if (!copy) return { ok: false, error: 'Could not write a compliant ad. Try rewording your offer.' };

      const row = await prisma.customerAd.create({
        data: {
          userId,
          headline: copy.headline,
          primaryText: copy.primaryText,
          link: input.link,
          dailyCents: daily,
          startsAt,
          endsAt,
          status: 'DRAFT',
        },
      });

      const ctx = ctxFor(loaded);
      const scheduled = startsAt.getTime() > now.getTime();
      try {
        const hash = await uploadImage(await generateAdImage(copy.imagePrompt), ctx);
        const campaignId = await createCampaign(`AppWeaver ad ${row.id}`, ctx);
        const adSetId = await createAdSet(campaignId, `AppWeaver ad set ${row.id}`, ctx, {
          dailyBudgetCents: daily,
          startTime: scheduled ? startsAt.toISOString() : undefined,
          endTime: endsAt.toISOString(),
        });
        const metaAdId = await createAd(
          {
            name: `AppWeaver ad ${row.id}`,
            adSetId,
            imageHash: hash,
            headline: copy.headline,
            primaryText: copy.primaryText,
            link: input.link,
          },
          ctx,
        );
        await prisma.customerAd.update({
          where: { id: row.id },
          data: { status: scheduled ? 'SCHEDULED' : 'ACTIVE', metaAdId, metaCampaign: campaignId },
        });
        revalidatePath('/app/studio');
        return {
          ok: true,
          message: scheduled
            ? `Your ad "${copy.headline}" is scheduled for ${startsAt.toUTCString()}.`
            : `Your ad is live: "${copy.headline}". Meta may still review it.`,
        };
      } catch (error) {
        console.error('[meta-ads] launch failed:', error);
        await prisma.customerAd.update({ where: { id: row.id }, data: { status: 'FAILED' } });
        return { ok: false, error: 'Meta rejected the launch. Nothing was spent.' };
      }
    },
  );
  return charged.ok ? charged.value : { ok: false, error: charged.error };
}

export async function pauseCustomerAdAction(adId: string): Promise<Result> {
  const userId = await currentUser();
  if (!userId) return { ok: false, error: 'You must be signed in.' };
  const ad = await prisma.customerAd.findFirst({ where: { id: adId, userId } });
  if (!ad?.metaAdId) return { ok: false, error: 'Ad not found.' };
  const loaded = await loadConnection(userId);
  if (!loaded) return { ok: false, error: 'Connect Facebook again to manage this ad.' };
  try {
    await setAdStatus(ad.metaAdId, 'PAUSED', ctxFor(loaded));
    await prisma.customerAd.update({ where: { id: ad.id }, data: { status: 'PAUSED' } });
    revalidatePath('/app/studio');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not pause the ad. Pause it in Meta Ads Manager.' };
  }
}
