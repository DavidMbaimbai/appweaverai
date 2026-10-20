import { sendAlert } from '@/lib/alerts';
import { generateAdCopy } from '@/lib/ads/copy';
import { generateAdImage } from '@/lib/ads/image';
import {
  createAd,
  createAdSet,
  createCampaign,
  getAdInsights,
  metaAdsEnabled,
  setAdStatus,
  uploadImage,
} from '@/lib/ads/meta';
import { adsToPause, MAX_ACTIVE_ADS, type AdStats } from '@/lib/ads/optimize';
import { prisma } from '@/lib/prisma';
import { recordInternalOperation } from '@/lib/marketing-credits/internal-cost';

const SITE = 'https://appweaverai.com';

async function getState(key: string) {
  return (await prisma.adState.findUnique({ where: { key } }))?.value ?? null;
}

async function setState(key: string, value: string) {
  await prisma.adState.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function ensureAdSet() {
  let adSetId = await getState('meta_adset_id');
  if (adSetId) return adSetId;
  const campaignId = await createCampaign('AppWeaver AI - automated sign-ups');
  await setState('meta_campaign_id', campaignId);
  adSetId = await createAdSet(campaignId, 'AppWeaver AI - automated audience');
  await setState('meta_adset_id', adSetId);
  return adSetId;
}

/** Daily cycle: sync results, pause losers, and launch at most one new AI-made ad. */
export async function runAdsCycle() {
  if (!metaAdsEnabled()) return { enabled: false as const };

  const adSetId = await ensureAdSet();
  const result = { enabled: true as const, paused: 0, launched: 0, error: undefined as string | undefined };

  const active = await prisma.adCreative.findMany({
    where: { status: 'ACTIVE', metaAdId: { not: null } },
  });

  const stats: AdStats[] = [];
  for (const ad of active) {
    try {
      const insights = await getAdInsights(ad.metaAdId as string);
      await prisma.adCreative.update({ where: { id: ad.id }, data: insights });
      const signups = await prisma.adAttribution.count({ where: { content: ad.id } });
      stats.push({ id: ad.id, spendCents: insights.spendCents, clicks: insights.clicks, signups });
    } catch (error) {
      console.error('[ads] insights failed:', error);
    }
  }

  for (const id of adsToPause(stats)) {
    const ad = active.find((a) => a.id === id);
    if (!ad?.metaAdId) continue;
    try {
      await setAdStatus(ad.metaAdId, 'PAUSED');
      await prisma.adCreative.update({
        where: { id },
        data: { status: 'PAUSED', note: 'Paused by optimizer: low performance.' },
      });
      result.paused += 1;
    } catch (error) {
      console.error('[ads] pause failed:', error);
    }
  }

  const stillActive = active.length - result.paused;
  if (stillActive >= MAX_ACTIVE_ADS) return result;

  const creative = await launchNewCreative(adSetId).catch(async (error) => {
    result.error = String(error);
    await sendAlert('Ad launch failed', String(error).slice(0, 1200));
    return null;
  });
  if (creative) result.launched = 1;
  return result;
}

async function launchNewCreative(adSetId: string) {
  const previous = await prisma.adCreative.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { headline: true, primaryText: true, clicks: true, status: true },
  });
  const winners = [...previous]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 3)
    .map((p) => `${p.headline}: ${p.primaryText}`);
  const recent = previous.map((p) => `${p.headline}: ${p.primaryText}`);

  const copy = await generateAdCopy(winners, recent);
  if (!copy) throw new Error('Ad copy failed validation.');

  const row = await prisma.adCreative.create({ data: { ...copy } });
  await recordInternalOperation('ad_pack', { refType: 'AdCreative', refId: row.id });
  try {
    const hash = await uploadImage(await generateAdImage(copy.imagePrompt));
    await recordInternalOperation('image', { refType: 'AdCreative', refId: row.id });
    const link = `${SITE}/?utm_source=facebook&utm_medium=paid&utm_campaign=aw_auto&utm_content=${row.id}`;
    const metaAdId = await createAd({
      name: `AW ${row.id}`,
      adSetId,
      imageHash: hash,
      headline: copy.headline,
      primaryText: copy.primaryText,
      link,
    });
    return await prisma.adCreative.update({
      where: { id: row.id },
      data: { status: 'ACTIVE', metaAdId },
    });
  } catch (error) {
    await prisma.adCreative.update({
      where: { id: row.id },
      data: { status: 'FAILED', note: String(error).slice(0, 500) },
    });
    throw error;
  }
}
