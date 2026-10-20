import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { hasBearerSecret } from '@/lib/rate-limit';
import { ingestInteraction } from '@/lib/social/replies/process';

const STATUSES = [
  'RECEIVED',
  'PROCESSING',
  'PENDING_APPROVAL',
  'SENT',
  'SKIPPED',
  'FAILED',
] as const;

const interactionSchema = z.object({
  /** X, LINKEDIN, FACEBOOK, INSTAGRAM, REDDIT, YOUTUBE; anything else is stored as OTHER. */
  platform: z.string().min(1).max(40),
  externalId: z.string().min(1).max(200),
  replyToId: z.string().max(200).optional(),
  authorHandle: z.string().min(1).max(200),
  authorName: z.string().max(200).optional(),
  text: z.string().min(1).max(8000),
  /** Set for reviews/ratings: stored for a human, never answered by AI. */
  isReview: z.boolean().optional(),
});

// SOCIAL_WEBHOOK_SECRET lets a separate secret be given to webhook senders;
// CRON_SECRET is accepted too, matching the other /api/social endpoints.
function authorized(request: Request) {
  return (
    hasBearerSecret(request, process.env.SOCIAL_WEBHOOK_SECRET) ||
    hasBearerSecret(request, process.env.CRON_SECRET)
  );
}

/** Ingest one or many inbound comments/mentions/DMs (generic webhook for any source). */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const parsed = interactionSchema.array().min(1).max(100).safeParse(
    await request.json().then((b) => (Array.isArray(b) ? b : [b])).catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body.', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const results = [];
  for (const item of parsed.data) results.push(await ingestInteraction(item));
  return NextResponse.json({
    success: true,
    received: results.filter((r) => r.created).length,
    duplicates: results.filter((r) => !r.created).length,
  });
}

/** List interactions, e.g. ?status=PENDING_APPROVAL for the approval queue. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status')?.toUpperCase();
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);

  const interactions = await prisma.socialInteraction.findMany({
    where: status ? { status: status as (typeof STATUSES)[number] } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return NextResponse.json({ interactions });
}
