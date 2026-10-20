import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasBearerSecret } from '@/lib/rate-limit';
import { reviewInteraction } from '@/lib/social/replies/process';

const reviewSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), reply: z.string().min(1).max(3000).optional() }),
  z.object({ action: z.literal('reject') }),
]);

type Context = { params: Promise<{ id: string }> };

/** Approve (optionally with an edited reply) or reject a held interaction. */
export async function PATCH(request: Request, { params }: Context) {
  if (
    !hasBearerSecret(request, process.env.SOCIAL_WEBHOOK_SECRET) &&
    !hasBearerSecret(request, process.env.CRON_SECRET)
  ) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const { id } = await params;
  const outcome = await reviewInteraction(id, parsed.data);
  if (outcome.ok) return NextResponse.json({ success: true });

  const status = outcome.error === 'not-reviewable' ? 409 : outcome.error === 'empty-reply' ? 422 : 502;
  return NextResponse.json({ error: outcome.error }, { status });
}
