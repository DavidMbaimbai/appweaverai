import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { denyDeviceAuthorization } from '@/lib/cli-auth';

const bodySchema = z.object({
  userCode: z.string().trim().min(1),
});

/** Called from the web activation page to deny a pending CLI login. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const result = await denyDeviceAuthorization(parsed.data.userCode, userId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ success: true });
}
