import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { setTyping } from '@/lib/agent/typing-presence';

/**
 * Records (or clears) that the current user is actively composing a
 * message in the shared agent conversation input. Polled indirectly via
 * the agent/sync route's `typingUsers` field so teammates see a live
 * "so-and-so is typing…" indicator — the closest analog to a cursor
 * presence indicator for an app whose only collaborative editing surface
 * is the AI chat input.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await context.params;
  const project = await getAccessibleProject(projectId, userId, { id: true });
  if (!project) {
    return Response.json({ error: 'Project not found.' }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const isTyping = Boolean(json?.isTyping);

  setTyping(
    projectId,
    { userId, name: session.user.name || session.user.email || 'Someone' },
    isTyping,
  );

  return Response.json({ ok: true });
}
