import { NextResponse } from 'next/server';

import { submitRequest } from '@/lib/privacy/requests';
import { clientIp, rateLimit } from '@/lib/rate-limit';

const GENERIC = { ok: true, message: 'If the details are valid, we have emailed a confirmation link. Your request starts once you confirm it.' };

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = await rateLimit(`privacy-request:${ip}`, 5, 3_600_000);
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const text = (value: unknown) => (typeof value === 'string' ? value : '');

  // A per-address limit stops the form being used to mail-bomb someone.
  const email = text(body.email).trim().toLowerCase();
  if (email) {
    const perEmail = await rateLimit(`privacy-request-email:${email}`, 3, 86_400_000);
    if (!perEmail.ok) return NextResponse.json(GENERIC);
  }

  const result = await submitRequest({
    type: text(body.type),
    name: text(body.name),
    email: text(body.email),
    phone: text(body.phone),
    details: text(body.details),
    ip,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(GENERIC);
}
