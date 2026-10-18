import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { normalizePlatforms } from '@/lib/social/publish';

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

const postSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(3000),
  videoUrl: z.url({ protocol: /^https$/ }).optional(),
  platforms: z.array(z.string()).optional(),
  scheduledFor: z.coerce.date().optional(),
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

  const created = await prisma.socialPost.createManyAndReturn({
    data: parsed.data.map((p) => ({
      title: p.title,
      message: p.message,
      videoUrl: p.videoUrl,
      platforms: normalizePlatforms(p.platforms),
      scheduledFor: p.scheduledFor,
    })),
    select: { id: true, scheduledFor: true },
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
