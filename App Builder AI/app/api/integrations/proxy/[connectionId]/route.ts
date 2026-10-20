import { NextResponse } from 'next/server';

import { executeProxy, MAX_PROXY_REQUEST_BYTES } from '@/lib/integrations/proxy';
import { clientIp, limitOrResponse } from '@/lib/rate-limit';

type Context = { params: Promise<{ connectionId: string }> };

/** Server-side API proxy for generated apps. Authenticated with the project's proxy token (never a browser credential). */
export async function POST(request: Request, context: Context) {
  const { connectionId } = await context.params;

  const limited = await limitOrResponse(`integration-proxy-ip:${clientIp(request)}`, 300, 60_000);
  if (limited) return limited;

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!bearer) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_PROXY_REQUEST_BYTES) return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Send a JSON body with method and path.' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Send a JSON object.' }, { status: 400 });
  }

  const result = await executeProxy({ connectionId, bearer, payload: payload as Record<string, unknown> });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.httpStatus, headers: result.retryAfter ? { 'retry-after': String(result.retryAfter) } : undefined },
    );
  }
  return NextResponse.json({ status: result.status, body: result.body });
}
