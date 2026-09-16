import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import {
  listActivePresence,
  recordHeartbeat,
  removePresence,
} from '@/lib/presence';

async function requireProjectAccess(
  projectId: string,
): Promise<
  | { userId: string; name: string; image: string | null }
  | { error: Response }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const project = await getAccessibleProject(projectId, userId, { id: true });

  if (!project) {
    return {
      error: Response.json({ error: 'Project not found.' }, { status: 404 }),
    };
  }

  return {
    userId,
    name: session.user.name || session.user.email || 'Someone',
    image: session.user.image ?? null,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  return Response.json({ collaborators: listActivePresence(projectId) });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const collaborators = recordHeartbeat(projectId, {
    userId: access.userId,
    name: access.name,
    image: access.image,
  });

  return Response.json({ collaborators });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  removePresence(projectId, access.userId);

  return Response.json({ success: true });
}
