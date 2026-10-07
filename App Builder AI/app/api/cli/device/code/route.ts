import { z } from 'zod';

import { startDeviceAuthorization } from '@/lib/cli-auth';

const bodySchema = z.object({
  clientName: z.string().trim().min(1).max(100).optional(),
});

/** Called by the CLI to start the device-authorization login flow. */
export async function POST(request: Request) {
  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const result = await startDeviceAuthorization(parsed.data.clientName);

  return Response.json({
    device_code: result.deviceCode,
    user_code: result.userCode,
    verification_uri: result.verificationUri,
    verification_uri_complete: result.verificationUriComplete,
    expires_in: result.expiresIn,
    interval: result.interval,
  });
}
