import { z } from 'zod';

import { rotateCliRefreshToken } from '@/lib/cli-auth';
import { clientIp, limitOrResponse } from '@/lib/rate-limit';

const bodySchema = z.object({
  refresh_token: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const limited = await limitOrResponse(
    `cli-refresh:${clientIp(request)}`,
    20,
    60_000,
  );
  if (limited) return limited;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await rotateCliRefreshToken(parsed.data.refresh_token);
  if (result.status === 'invalid_grant') {
    return Response.json({ error: result.status }, { status: 400 });
  }

  return Response.json({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    expires_in: result.expiresIn,
    token_type: result.tokenType,
    user: result.user,
  });
}
