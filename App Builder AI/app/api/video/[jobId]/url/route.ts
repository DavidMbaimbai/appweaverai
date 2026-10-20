import { NextResponse } from 'next/server';

import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { VIDEO_URL_TTL_SECONDS, presignVideoUrl } from '@/lib/video/storage';

/** Mints a short-lived presigned URL for the owner's finished video. */
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });
  }

  const limit = await rateLimit(`video-url:${userId}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    );
  }

  const { jobId } = await context.params;
  const job = await prisma.videoJob.findFirst({
    where: { id: jobId, userId },
    select: { status: true, outputKey: true },
  });
  if (!job) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (job.status !== 'SUCCEEDED' || !job.outputKey) {
    return NextResponse.json({ error: 'Video is not ready.' }, { status: 409 });
  }

  const download = new URL(request.url).searchParams.get('download') === '1';
  try {
    const url = await presignVideoUrl(job.outputKey, { download, filename: `video-${jobId}.mp4` });
    return NextResponse.json(
      { url, expiresIn: VIDEO_URL_TTL_SECONDS },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[video] presign failed:', error);
    return NextResponse.json({ error: 'Video storage is unavailable.' }, { status: 503 });
  }
}
