import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';

import { MarketingWorkspace } from '@/components/app/marketing/marketing-workspace';
import { PageHeader } from '@/components/app/shell/page-header';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';
import { countBy, groupByDate, toLocalInput } from '@/lib/project-marketing/logic';
import { isConnectConfigured } from '@/lib/project-marketing/oauth';
import { PAGE_CHOICE_COOKIE, unpackPageChoices } from '@/lib/project-marketing/pages';

export const dynamic = 'force-dynamic';

const CONNECTABLE = ['X', 'LINKEDIN', 'FACEBOOK'] as const;

export default async function ProjectMarketingPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
  searchParams: Promise<{ connect?: string }>;
}) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();
  const { workspaceSlug, projectSlug } = await params;
  const { connect } = await searchParams;

  const project = await prisma.project.findFirst({
    where: { slug: projectSlug, workspace: { slug: workspaceSlug }, ...projectAccessWhere(userId) },
    select: {
      id: true,
      name: true,
      deployments: { where: { isCurrent: true, status: 'LIVE' }, take: 1, select: { domain: true, customDomain: true } },
    },
  });
  if (!project) notFound();

  const [campaigns, connections] = await Promise.all([
    prisma.projectCampaign.findMany({
      where: { projectId: project.id, userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { posts: { orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }] } },
    }),
    prisma.socialConnection.findMany({
      where: { userId },
      select: { platform: true, accountName: true, expiresAt: true },
    }),
  ]);

  const posts = campaigns.flatMap((c) => c.posts.map((p) => ({ ...p, campaignName: c.name })));
  const serialize = (p: (typeof posts)[number]) => ({
    id: p.id,
    campaignId: p.campaignId,
    campaignName: p.campaignName,
    platform: p.platform,
    text: p.text,
    hashtags: p.hashtags,
    imageUrl: p.imageUrl,
    status: p.status,
    error: p.error,
    timeZone: p.timeZone,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    localTime: toLocalInput(p.scheduledAt, p.timeZone),
    publishedAt: p.publishedAt?.toISOString() ?? null,
  });

  const nowMs = new Date().getTime();
  const pageChoices = unpackPageChoices((await cookies()).get(PAGE_CHOICE_COOKIE)?.value).map((p) => ({
    id: p.id,
    name: p.name,
  }));
  const host = project.deployments[0]?.customDomain || project.deployments[0]?.domain;
  const notice =
    connect === 'error' || connect === 'denied'
      ? 'The account was not connected.'
      : connect === 'choose-page'
        ? 'Choose which Facebook Page to use.'
        : connect
        ? 'Account connected.'
        : undefined;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title={`${project.name} · Marketing`} />
      <MarketingWorkspace
        projectId={project.id}
        projectPath={`${workspaceSlug}/${projectSlug}`}
        siteUrl={host ? `https://${host}` : null}
        notice={notice}
        pageChoices={pageChoices}
        connections={CONNECTABLE.map((platform) => {
          const existing = connections.find((c) => c.platform === platform);
          return {
            platform,
            configured: isConnectConfigured(platform),
            connected: Boolean(existing),
            accountName: existing?.accountName ?? null,
            expired: Boolean(existing?.expiresAt && existing.expiresAt.getTime() < nowMs && platform !== 'X'),
          };
        })}
        instagramViaFacebook={Boolean(connections.find((c) => c.platform === 'FACEBOOK'))}
        calendar={groupByDate(posts.filter((p) => p.scheduledAt).map((p) => ({ ...p, serialized: serialize(p) }))).map(
          (g) => ({ date: g.date, items: g.items.map((i) => i.serialized) }),
        )}
        campaigns={campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
          posts: c.posts.map((p) => serialize({ ...p, campaignName: c.name })),
        }))}
        byStatus={countBy(posts, (p) => p.status)}
        byPlatform={countBy(posts, (p) => p.platform)}
      />
    </main>
  );
}
