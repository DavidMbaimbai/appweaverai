import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { hasBearerSecret } from '@/lib/rate-limit';

const STATUSES = [
  'DISCOVERED',
  'PENDING_APPROVAL',
  'SENDING',
  'SENT',
  'REJECTED',
  'DO_NOT_CONTACT',
] as const;

/**
 * Lists investor leads. ?status=PENDING_APPROVAL is the email approval queue;
 * ?calls=true is the call list (leads with a published phone number, with talking
 * points) for David to dial personally.
 */
export async function GET(request: Request) {
  if (!hasBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status')?.toUpperCase();
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  const calls = url.searchParams.get('calls') === 'true';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);

  const leads = await prisma.investorLead.findMany({
    where: {
      ...(status ? { status: status as (typeof STATUSES)[number] } : {}),
      ...(calls ? { phone: { not: null }, status: { notIn: ['DO_NOT_CONTACT', 'REJECTED'] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return NextResponse.json({ leads });
}
