import { NextResponse } from 'next/server';
import { z } from 'zod';

import { reviewLead } from '@/lib/outreach/process';
import { hasBearerSecret } from '@/lib/rate-limit';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    subject: z.string().min(1).max(150).optional(),
    body: z.string().min(1).max(3000).optional(),
  }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('do-not-contact') }),
]);

const STATUS_BY_ERROR = {
  'not-reviewable': 409,
  suppressed: 409,
  'no-email': 422,
  'not-configured': 500,
  'daily-limit': 429,
  'send-failed': 502,
} as const;

type Context = { params: Promise<{ id: string }> };

/** Approve (optionally with an edited subject/body), reject, or mark do-not-contact. */
export async function PATCH(request: Request, { params }: Context) {
  if (!hasBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const { id } = await params;
  const outcome = await reviewLead(id, parsed.data);
  if (outcome.ok) return NextResponse.json({ success: true });
  return NextResponse.json({ error: outcome.error }, { status: STATUS_BY_ERROR[outcome.error] });
}
