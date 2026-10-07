import { z } from 'zod';

import { exchangeDeviceCodeForToken } from '@/lib/cli-auth';

const bodySchema = z.object({
  device_code: z.string().trim().min(1),
});

/** Polled by the CLI until the device code has been approved or rejected. */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await exchangeDeviceCodeForToken(parsed.data.device_code);

  if (result.status === 'approved') {
    return Response.json({
      access_token: result.accessToken,
      token_type: result.tokenType,
      user: result.user,
    });
  }

  const statusCode =
    result.status === 'authorization_pending' ||
    result.status === 'slow_down'
      ? 200
      : 400;

  return Response.json({ error: result.status }, { status: statusCode });
}
