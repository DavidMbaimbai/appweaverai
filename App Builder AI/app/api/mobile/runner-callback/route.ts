import { NextResponse } from 'next/server';

import { parseRunnerCallback } from '@/lib/mobile/provider';
import { applyRunnerCallback } from '@/lib/mobile/service';
import { clientIp, hasBearerSecret, limitOrResponse } from '@/lib/rate-limit';

/** Status callback from the operator's native build runner, authenticated with the shared runner token. */
export async function POST(request: Request) {
  const limited = await limitOrResponse(`mobile-runner:${clientIp(request)}`, 120, 60_000);
  if (limited) return limited;
  if (!hasBearerSecret(request, process.env.MOBILE_BUILD_RUNNER_TOKEN?.trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const callback = parseRunnerCallback(body);
  if ('error' in callback) return NextResponse.json({ error: callback.error }, { status: 400 });
  const result = await applyRunnerCallback(callback);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
