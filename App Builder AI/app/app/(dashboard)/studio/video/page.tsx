import { PageHeader } from '@/components/app/shell/page-header';
import { VideoStudio, type ProjectView } from '@/components/app/studio/video/video-studio';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { monthlyVideoQuota } from '@/lib/video/quota';
import { userVideosThisMonth } from '@/lib/video/jobs';

export const dynamic = 'force-dynamic';

export default async function VideoStudioPage() {
  const userId = (await getCachedSession())?.user?.id;
  const hasDb = Boolean(userId && process.env.DATABASE_URL);

  let projects: ProjectView[] = [];
  let used = 0;
  let limit = monthlyVideoQuota('free');
  if (hasDb && userId) {
    const [rows, user, count] = await Promise.all([
      prisma.videoProject.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        include: {
          scenes: { orderBy: { order: 'asc' }, include: { job: true } },
        },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { subscriptionPlan: true } }),
      userVideosThisMonth(userId),
    ]);
    used = count;
    limit = monthlyVideoQuota(user?.subscriptionPlan);
    projects = rows.map((project) => ({
      id: project.id,
      title: project.title,
      kind: project.kind,
      scenes: project.scenes.map((scene) => ({
        id: scene.id,
        prompt: scene.prompt,
        seconds: scene.seconds,
        season: scene.season,
        episode: scene.episode,
        hasImage: Boolean(scene.referenceImageKey),
        job: scene.job
          ? {
              id: scene.job.id,
              status: scene.job.status,
              progress: scene.job.progress,
              error: scene.job.error,
              costCents: scene.job.actualCostCents || scene.job.estimatedCostCents,
            }
          : null,
      })),
    }));
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Video studio" />
      <div className="mx-auto w-full max-w-app-content flex-1 space-y-6 px-4 py-6 tablet-up:px-8">
        {hasDb ? (
          <VideoStudio projects={projects} usedThisMonth={used} monthlyLimit={limit} />
        ) : (
          <p className="text-sm text-app-text-muted">Sign in to create AI videos.</p>
        )}
      </div>
    </main>
  );
}
