import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { hasBearerSecret } from '@/lib/rate-limit';
import { normalizePlatforms } from '@/lib/social/publish';
import { validateMarketingVideo } from '@/lib/social/video';

function authorized(request: Request) {
  return hasBearerSecret(request, process.env.CRON_SECRET);
}

const postSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(3000),
  videoUrl: z.url({ protocol: /^https$/ }).optional(),
  platforms: z.array(z.string()).optional(),
  scheduledFor: z.coerce.date().optional(),
  /** Create as DRAFT (needs approval). Forced on when SOCIAL_REQUIRE_APPROVAL=true. */
  draft: z.boolean().optional(),
  /** Video length in seconds when the file has no readable MP4 metadata (max 180). */
  durationSeconds: z.number().positive().optional(),
});

/** Queue a marketing post (video + message). Authorization: Bearer CRON_SECRET. */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const parsed = postSchema.array().min(1).max(100).safeParse(
    await request.json().then((b) => (Array.isArray(b) ? b : [b])).catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body.', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  for (const [index, p] of parsed.data.entries()) {
    if (!p.videoUrl) continue;
    const problem = await validateMarketingVideo(p.videoUrl, p.durationSeconds);
    if (problem) {
      return NextResponse.json(
        { error: problem, index },
        { status: 422 },
      );
    }
  }

  const created = await prisma.socialPost.createManyAndReturn({
    data: parsed.data.map((p) => ({
      title: p.title,
      message: p.message,
      videoUrl: p.videoUrl,
      platforms: normalizePlatforms(p.platforms),
      scheduledFor: p.scheduledFor,
      status:
        p.draft || process.env.SOCIAL_REQUIRE_APPROVAL === 'true'
          ? ('DRAFT' as const)
          : ('PENDING' as const),
    })),
    select: { id: true, scheduledFor: true, status: true },
  });

  return NextResponse.json({ success: true, posts: created }, { status: 201 });
}

/** List recent posts and their per-platform results. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const posts = await prisma.socialPost.findMany({
    orderBy: { scheduledFor: 'desc' },
    take: 50,
  });
  return NextResponse.json({ posts });
}
