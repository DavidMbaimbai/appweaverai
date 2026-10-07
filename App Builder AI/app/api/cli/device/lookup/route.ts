import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { findPendingDeviceAuthorizationByUserCode } from '@/lib/cli-auth';

const querySchema = z.object({
  userCode: z.string().trim().min(1),
});

/** Looks up a pending device authorization so the web page can confirm it exists before approving. */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    userCode: searchParams.get('userCode') ?? '',
  });
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const record = await findPendingDeviceAuthorizationByUserCode(
    parsed.data.userCode,
  );
  if (!record) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  return Response.json({
    userCode: record.userCode,
    clientName: record.clientName,
    expiresAt: record.expiresAt,
  });
}
