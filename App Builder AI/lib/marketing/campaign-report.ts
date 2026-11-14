import { prisma } from '@/lib/prisma';

export interface PostReportRow {
  postId: string;
  platform: string;
  publishedAt: Date | null;
  // platform-reported
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  // first-party (UTM-attributed)
  visits: number;
  visitors: number;
  signups: number;
  revenue: number;
  // derived (null when the denominator is 0)
  clickThroughRate: number | null; // visitors / impressions (approximate)
  signupRate: number | null; // signups / visitors
}

export async function getCampaignReport(projectId: string, opts: { days?: number } = {}) {
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const posts = await prisma.projectPost.findMany({
    where: { projectId, status: 'PUBLISHED', publishedAt: { gte: since } },
    select: { id: true, platform: true, publishedAt: true },
    orderBy: { publishedAt: 'desc' },
  });
  const ids = posts.map((p) => p.id);
  if (ids.length === 0) return { rows: [] as PostReportRow[], totals: null };

  const site = await prisma.analyticsSite.findUnique({ where: { projectId }, select: { id: true } });

  const [snapshots, events] = await Promise.all([
    prisma.postMetricSnapshot.findMany({
      where: { postId: { in: ids } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['postId'], // latest snapshot per post
    }),
    site
      ? prisma.$queryRaw<
          Array<{ post_id: string; visits: bigint; visitors: bigint; signups: bigint; revenue: string | null }>
        >`
          SELECT "utmContent" AS post_id,
                 COUNT(*) FILTER (WHERE name = 'pageview')                         AS visits,
                 COUNT(DISTINCT "visitorId") FILTER (WHERE name = 'pageview')      AS visitors,
                 COUNT(*) FILTER (WHERE name = 'signup')                           AS signups,
                 COALESCE(SUM(value) FILTER (WHERE name = 'purchase'), 0)::text    AS revenue
          FROM "AnalyticsEvent"
          WHERE "siteId" = ${site.id}
            AND "utmContent" = ANY(${ids})
            AND "createdAt" >= ${since}
          GROUP BY 1`
      : Promise.resolve([]),
  ]);

  const snapByPost = new Map(snapshots.map((s) => [s.postId, s]));
  const evByPost = new Map(events.map((e) => [e.post_id, e]));
  const ratio = (a: number, b: number | null | undefined) => (b ? a / b : null);

  const rows: PostReportRow[] = posts.map((p) => {
    const s = snapByPost.get(p.id);
    const e = evByPost.get(p.id);
    const visitors = Number(e?.visitors ?? 0);
    const signups = Number(e?.signups ?? 0);
    return {
      postId: p.id,
      platform: p.platform,
      publishedAt: p.publishedAt,
      impressions: s?.impressions ?? null,
      reach: s?.reach ?? null,
      likes: s?.likes ?? null,
      comments: s?.comments ?? null,
      shares: s?.shares ?? null,
      visits: Number(e?.visits ?? 0),
      visitors,
      signups,
      revenue: Number(e?.revenue ?? 0),
      clickThroughRate: ratio(visitors, s?.impressions),
      signupRate: ratio(signups, visitors),
    };
  });

  const sum = (f: (r: PostReportRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const totals = {
    posts: rows.length,
    impressions: sum((r) => r.impressions ?? 0),
    visitors: sum((r) => r.visitors),
    signups: sum((r) => r.signups),
    revenue: sum((r) => r.revenue),
  };
  return { rows, totals };
}