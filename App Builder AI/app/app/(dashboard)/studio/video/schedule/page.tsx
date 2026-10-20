import { PageHeader } from '@/components/app/shell/page-header';
import { VideoScheduler } from '@/components/app/studio/video/schedule/video-scheduler';
import type { CapabilityView, SchedulerData } from '@/components/app/studio/video/schedule/types';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import {
  connectionPlatformFor,
  getCapability,
  RELEASE_PLATFORMS,
  type ReleasePlatform,
} from '@/lib/video-release/capabilities';
import { pendingLimit as planPendingLimit } from '@/lib/video-release/status';

export const dynamic = 'force-dynamic';

const currentTime = () => Date.now();

function limitsText(platform: ReleasePlatform) {
  const cap = getCapability(platform);
  const mins = cap.maxSeconds >= 3600 ? `${Math.round(cap.maxSeconds / 3600)} h` : `${cap.maxSeconds} s`;
  return `${cap.minSeconds}s–${mins}, up to ${Math.round(cap.maxBytes / 1024 / 1024)} MB, ${cap.aspects.join(' / ')}`;
}

export default async function VideoSchedulePage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
  const userId = (await getCachedSession())?.user?.id;
  const connectFlag = (await searchParams).connect ?? null;
  const hasDb = Boolean(userId && process.env.DATABASE_URL);

  let data: SchedulerData | null = null;
  if (hasDb && userId) {
    const [releases, connections, projects, user] = await Promise.all([
      prisma.videoRelease.findMany({ where: { userId }, orderBy: { scheduledAt: 'asc' }, take: 500 }),
      prisma.socialConnection.findMany({ where: { userId } }),
      prisma.videoProject.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        include: { scenes: { orderBy: { order: 'asc' }, include: { job: true } } },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { subscriptionPlan: true } }),
    ]);

    const now = currentTime();
    const capabilities: CapabilityView[] = RELEASE_PLATFORMS.map((platform) => {
      const cap = getCapability(platform);
      const conn = connections.find((c) => c.platform === connectionPlatformFor(platform));
      const expired = Boolean(conn?.expiresAt && conn.expiresAt.getTime() < now && !conn.refreshTokenEnc);
      const connected = Boolean(conn) && !expired;
      const own = platform === 'YOUTUBE' || platform === 'TIKTOK';
      return {
        platform,
        label: cap.label,
        deploymentMode: cap.mode,
        effective: cap.mode === 'automatic' && connected ? 'automatic' : 'manual',
        connected,
        expired,
        accountName: conn?.accountName ?? null,
        note: cap.note,
        privateOnly: cap.privateOnly,
        limits: limitsText(platform),
        connectHref: cap.mode === 'automatic' && own ? `/api/video-release/connect/${platform.toLowerCase()}` : null,
        connectHint: own
          ? 'Connect your account here.'
          : 'Connect this account from a project’s Marketing tab; the same connection is used here.',
      };
    });

    const videos = projects.flatMap((p) =>
      p.scenes.flatMap((s) =>
        s.job && s.job.status === 'SUCCEEDED' && s.job.outputKey
          ? [{ jobId: s.job.id, label: `${p.title} · ${s.prompt.slice(0, 48)}`, seconds: s.job.seconds, aspect: s.job.aspect }]
          : [],
      ),
    );

    const pending = ['SCHEDULED', 'APPROVED', 'PAUSED', 'PUBLISHING'];
    data = {
      nowIso: new Date(now).toISOString(),
      releases: releases.map((r) => ({
        id: r.id,
        platform: r.platform,
        language: r.language,
        title: r.title,
        caption: r.caption,
        hashtags: r.hashtags,
        status: r.status,
        scheduledAt: r.scheduledAt.toISOString(),
        timeZone: r.timeZone,
        jobId: r.jobId,
        season: r.season,
        episode: r.episode,
        seriesKey: r.seriesKey,
        error: r.error,
        note: r.note,
        postUrl: r.postUrl,
        attempts: r.attempts,
        nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
        views: typeof (r.metrics as { views?: unknown } | null)?.views === 'number' ? ((r.metrics as { views: number }).views) : null,
      })),
      capabilities,
      videos,
      projects: projects
        .filter((p) => p.scenes.some((s) => s.job?.status === 'SUCCEEDED'))
        .map((p) => ({
          id: p.id,
          title: p.title,
          kind: p.kind,
          episodes: p.scenes.filter((s) => s.job?.status === 'SUCCEEDED').length,
        })),
      pendingCount: releases.filter((r) => pending.includes(r.status)).length,
      pendingLimit: planPendingLimit(user?.subscriptionPlan),
      connectFlag,
    };
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Video release scheduler" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-6 px-4 py-6 tablet-up:px-8">
        {data ? <VideoScheduler data={data} /> : <p className="text-sm text-app-text-muted">Sign in to schedule videos.</p>}
      </div>
    </main>
  );
}
