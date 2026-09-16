import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { restoreProjectCheckpoint } from '@/lib/project-checkpoints';

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string; checkpointId: string }> },
) {
  const { projectId, checkpointId } = await context.params;

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const project = await getAccessibleProject(projectId, userId, { id: true });
  if (!project) {
    return Response.json({ error: 'Project not found.' }, { status: 404 });
  }

  const result = await restoreProjectCheckpoint({
    projectId,
    checkpointId,
    actorId: userId,
  });

  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json(result);
}
