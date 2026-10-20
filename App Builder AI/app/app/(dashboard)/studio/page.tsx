import { PageHeader } from '@/components/app/shell/page-header';
import { LaunchWorkbench } from '@/components/app/studio/launch-workbench';
import { MetaAdsPanel } from '@/components/app/studio/meta-ads-panel';
import { StudioWorkbench } from '@/components/app/studio/studio-workbench';
import { customerAdsConfigured, listAssets, type MetaAssets } from '@/lib/ads/customer-oauth';
import { decryptSecret } from '@/lib/crypto/secret-box';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string }>;
}) {
  const { meta } = await searchParams;
  const userId = (await getCachedSession())?.user?.id;
  const hasDb = Boolean(userId && process.env.DATABASE_URL);
  const saved = hasDb
    ? await prisma.launchKit.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    : [];

  const configured = customerAdsConfigured();
  const connection = hasDb && configured ? await prisma.metaAdConnection.findUnique({ where: { userId } }) : null;
  const ads = hasDb && configured
    ? await prisma.customerAd.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 })
    : [];
  const ready = Boolean(connection?.adAccountId && connection?.pageId);
  let assets: MetaAssets | null = null;
  if (connection && !ready) {
    try {
      assets = await listAssets(decryptSecret(connection.accessTokenEnc));
    } catch {
      assets = null;
    }
  }
  const notice =
    meta === 'connected'
      ? 'Facebook connected. Choose your ad account and page.'
      : meta === 'denied' || meta === 'error'
        ? 'Facebook was not connected.'
        : undefined;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Studio" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-10 px-4 py-6 tablet-up:px-8">
        <p className="text-sm text-app-text-muted">
          Design, marketing, advertising and strategy in one place. Describe what you need and
          AI produces it.
        </p>
        <LaunchWorkbench />
        {saved.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-medium text-app-text">Your saved launch kits</h2>
            <div className="space-y-2">
              {saved.map((kit) => (
                <details key={kit.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
                  <summary className="cursor-pointer text-sm text-app-text">
                    {kit.brief.slice(0, 90)}
                    <span className="ml-2 text-xs text-app-text-muted">{kit.createdAt.toLocaleDateString('en-GB')}</span>
                  </summary>
                  <div className="mt-3 space-y-4 whitespace-pre-wrap text-sm text-app-text-secondary">
                    <div><strong>Brand kit</strong>{'\n'}{kit.brand}</div>
                    <div><strong>Ad pack</strong>{'\n'}{kit.adPack}</div>
                    <div><strong>30-day plan</strong>{'\n'}{kit.plan}</div>
                  </div>
                </details>
              ))}
            </div>
          </section>
        ) : null}
        <hr className="border-app-border-subtle" />
        <MetaAdsPanel
          configured={configured}
          notice={notice}
          assets={assets}
          connection={
            connection
              ? {
                  adAccountName: connection.adAccountName,
                  pageName: connection.pageName,
                  currency: connection.currency,
                  dailyCapCents: connection.dailyCapCents,
                  ready,
                }
              : null
          }
          ads={ads.map((a) => ({
            id: a.id,
            headline: a.headline,
            primaryText: a.primaryText,
            status: a.status,
            startsAt: a.startsAt.toISOString(),
            endsAt: a.endsAt.toISOString(),
            dailyCents: a.dailyCents,
            spendCents: a.spendCents,
            clicks: a.clicks,
            impressions: a.impressions,
          }))}
        />
        <hr className="border-app-border-subtle" />
        <StudioWorkbench />
      </div>
    </main>
  );
}
