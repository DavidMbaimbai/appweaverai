import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { decideToolCall } from '@/lib/agent/tool-approval';

const bodySchema = z.object({
  decision: z.enum(['approved', 'denied']),
});

/** Called from the editor when a user approves/denies a pending DESTRUCTIVE tool call. */
export async function POST(
  request: Request,
  context: { params: Promise<{ toolCallId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { toolCallId } = await context.params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const result = await decideToolCall({
    toolCallId,
    userId,
    decision: parsed.data.decision === 'approved' ? 'APPROVED' : 'DENIED',
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ success: true });
}
