import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { hasBearerSecret } from '@/lib/rate-limit';
import { normalizePlatforms } from '@/lib/social/publish';
import { validateMarketingVideo } from '@/lib/social/video';

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(3000).optional(),
  videoUrl: z.url({ protocol: /^https$/ }).nullable().optional(),
  platforms: z.array(z.string()).optional(),
  scheduledFor: z.coerce.date().optional(),
  /** `approve` moves a DRAFT to PENDING; `retry` re-queues a FAILED post. */
  action: z.enum(['approve', 'retry']).optional(),
  durationSeconds: z.number().positive().optional(),
});

type Context = { params: Promise<{ postId: string }> };

function authorized(request: Request) {
  return hasBearerSecret(request, process.env.CRON_SECRET);
}

/** Edit a queued post and/or approve (DRAFT -> PENDING) or retry (FAILED -> PENDING) it. */
export async function PATCH(request: Request, { params }: Context) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const { postId } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const { action, platforms, durationSeconds, ...fields } = parsed.data;

  const post = await prisma.socialPost.findUnique({ where: { id: postId } });
  if (!post) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (post.status === 'POSTED') {
    return NextResponse.json({ error: 'Already posted.' }, { status: 409 });
  }
  if (action === 'approve' && post.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Only drafts can be approved.' }, { status: 409 });
  }
  if (action === 'retry' && post.status !== 'FAILED') {
    return NextResponse.json({ error: 'Only failed posts can be retried.' }, { status: 409 });
  }

  if (fields.videoUrl) {
    const problem = await validateMarketingVideo(fields.videoUrl, durationSeconds);
    if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  }

  const updated = await prisma.socialPost.update({
    where: { id: postId },
    data: {
      ...fields,
      ...(platforms ? { platforms: normalizePlatforms(platforms) } : {}),
      ...(action ? { status: 'PENDING' } : {}),
      ...(action === 'retry' ? { attempts: 0 } : {}),
    },
  });
  return NextResponse.json({ success: true, post: updated });
}

/** Delete a post that has not been published. */
export async function DELETE(request: Request, { params }: Context) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const { postId } = await params;
  const { count } = await prisma.socialPost.deleteMany({
    where: { id: postId, status: { not: 'POSTED' } },
  });
  if (!count) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
