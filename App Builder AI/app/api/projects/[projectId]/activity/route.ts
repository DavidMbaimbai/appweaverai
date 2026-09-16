import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { listProjectActivity } from '@/lib/queries/project-activity';

export async function GET(
  _request: Request,
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

  const entries = await listProjectActivity(projectId, { limit: 50 });
  return Response.json({ entries });
}
