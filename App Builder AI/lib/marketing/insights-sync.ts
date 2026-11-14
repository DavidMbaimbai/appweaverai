import { prisma } from '@/lib/prisma';

export interface PostInsights {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  raw?: unknown;
}
export interface PlatformConnection {
  accessToken: string;
  accountId?: string;
}
export class InsightsAuthError extends Error {}

export interface InsightsAdapter {
  platform: string;
  fetchInsights(externalId: string, conn: PlatformConnection): Promise<PostInsights | null>;
}
export interface SyncDeps {
  adapters: Record<string, InsightsAdapter>;
  getConnection(projectId: string, platform: string): Promise<PlatformConnection | null>;
  /** Called once per (project, platform) per run when the token is rejected. */
  onAuthError?(projectId: string, platform: string): Promise<void>;
}
export interface SyncSummary {
  checked: number;
  synced: number;
  notDue: number;
  noAdapter: number;
  noConnection: number;
  authErrors: number;
  failed: number;
  timedOut: boolean;
}

/* ------------------------- sync scheduling ------------------------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Young posts change fast, old posts barely move: sync often early, rarely later. */
export function isDueForSync(publishedAt: Date, lastSyncedAt: Date | null, now = new Date()): boolean {
  if (!lastSyncedAt) return true;
  const age = now.getTime() - publishedAt.getTime();
  const interval = age < DAY ? 3 * HOUR : age < 7 * DAY ? DAY : 3 * DAY;
  return now.getTime() - lastSyncedAt.getTime() >= interval;
}

/* ----------------------------- runner ------------------------------ */

export async function syncPostInsights(
  deps: SyncDeps,
  opts: { batch?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<SyncSummary> {
  const { batch = 200, concurrency = 5, budgetMs = 50_000 } = opts;
  const deadline = Date.now() + budgetMs;
  const summary: SyncSummary = {
    checked: 0, synced: 0, notDue: 0, noAdapter: 0, noConnection: 0, authErrors: 0, failed: 0, timedOut: false,
  };

  const posts = await prisma.projectPost.findMany({
    where: {
      status: 'PUBLISHED',
      externalId: { not: null },
      publishedAt: { gte: new Date(Date.now() - 30 * DAY) },
    },
    // Never-synced posts first (Postgres sorts NULLs last on ASC by default).
    orderBy: { metricsSyncedAt: { sort: 'asc', nulls: 'first' } },
    take: batch,
    select: { id: true, projectId: true, platform: true, externalId: true, publishedAt: true, metricsSyncedAt: true },
  });

  const blocked = new Set<string>(); // `${projectId}:${platform}` after an auth failure this run
  const queue = posts.filter((p) => {
    if (!p.publishedAt || !p.externalId) return false;
    if (!isDueForSync(p.publishedAt, p.metricsSyncedAt)) {
      summary.notDue++;
      return false;
    }
    return true;
  });

  async function worker() {
    for (let post = queue.shift(); post; post = queue.shift()) {
      if (Date.now() > deadline) {
        summary.timedOut = true;
        return;
      }
      summary.checked++;
      const platform = String(post.platform).toLowerCase();
      const blockKey = `${post.projectId}:${platform}`;
      const adapter = deps.adapters[platform];
      if (!adapter) {
        summary.noAdapter++;
        continue;
      }
      if (blocked.has(blockKey)) continue;
      try {
        const conn = await deps.getConnection(post.projectId, platform);
        if (!conn) {
          summary.noConnection++;
          continue;
        }
        const insights = await adapter.fetchInsights(post.externalId!, conn);
        if (insights) {
          const { raw, ...numbers } = insights;
          await prisma.postMetricSnapshot.create({
            data: { postId: post.id, platform, ...numbers, raw: raw === undefined ? undefined : (raw as object) },
          });
        }
        await prisma.projectPost.update({ where: { id: post.id }, data: { metricsSyncedAt: new Date() } });
        summary.synced++;
      } catch (error) {
        if (error instanceof InsightsAuthError) {
          blocked.add(blockKey);
          summary.authErrors++;
          await deps.onAuthError?.(post.projectId, platform).catch(() => undefined);
        } else {
          summary.failed++; // one bad post must never stop the batch
        }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return summary;
}

/* ---------------------------- Meta adapters --------------------------- */

const GRAPH = 'https://graph.facebook.com/v21.0'; // pin deliberately; bump on a schedule
// VERIFY against the current Graph API docs before shipping (these change).
const FB_INSIGHT_METRICS = ['post_impressions', 'post_impressions_unique', 'post_clicks'];
const IG_INSIGHT_METRICS = ['reach', 'views'];

interface GraphInsightsResponse {
  data?: Array<{ name: string; values?: Array<{ value: number | Record<string, number> }> }>;
  error?: { code?: number; message?: string };
}

async function graphGet<T extends { error?: { code?: number } }>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const url = `${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: token })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }); // never log `url`: it holds the token
  const json = (await res.json().catch(() => ({}))) as T;
  if (json.error?.code === 190) throw new InsightsAuthError('Token expired or revoked');
  return json;
}

const metricValue = (res: GraphInsightsResponse, name: string): number | undefined => {
  const v = res.data?.find((m) => m.name === name)?.values?.[0]?.value;
  return typeof v === 'number' ? v : undefined;
};

export const facebookAdapter: InsightsAdapter = {
  platform: 'facebook',
  async fetchInsights(postId, conn) {
    const fields = await graphGet<{
      shares?: { count?: number };
      comments?: { summary?: { total_count?: number } };
      reactions?: { summary?: { total_count?: number } };
      error?: { code?: number };
    }>(postId, { fields: 'shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)' }, conn.accessToken);
    const insights = await graphGet<GraphInsightsResponse>(
      `${postId}/insights`,
      { metric: FB_INSIGHT_METRICS.join(',') },
      conn.accessToken,
    );
    if (fields.error && insights.error) return null; // nothing usable (deleted post, no permission)
    return {
      impressions: metricValue(insights, 'post_impressions'),
      reach: metricValue(insights, 'post_impressions_unique'),
      clicks: metricValue(insights, 'post_clicks'),
      likes: fields.reactions?.summary?.total_count,
      comments: fields.comments?.summary?.total_count,
      shares: fields.shares?.count,
      raw: { fields, insights },
    };
  },
};

export const instagramAdapter: InsightsAdapter = {
  platform: 'instagram',
  async fetchInsights(mediaId, conn) {
    const fields = await graphGet<{ like_count?: number; comments_count?: number; error?: { code?: number } }>(
      mediaId,
      { fields: 'like_count,comments_count' },
      conn.accessToken,
    );
    const insights = await graphGet<GraphInsightsResponse>(
      `${mediaId}/insights`,
      { metric: IG_INSIGHT_METRICS.join(',') },
      conn.accessToken,
    );
    if (fields.error && insights.error) return null;
    return {
      reach: metricValue(insights, 'reach'),
      impressions: metricValue(insights, 'views'),
      likes: fields.like_count,
      comments: fields.comments_count,
      raw: { fields, insights },
    };
  },
};

/** Register what you actually support. LinkedIn / X: add adapters once API access is confirmed. */
export const defaultAdapters: Record<string, InsightsAdapter> = {
  facebook: facebookAdapter,
  instagram: instagramAdapter,
};