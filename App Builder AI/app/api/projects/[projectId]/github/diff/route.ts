import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { computeGithubDiff } from '@/lib/project-github-export';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const project = await getAccessibleProject(projectId, userId, { id: true });
  if (!project) {
    return Response.json({ error: 'Project not found.' }, { status: 404 });
  }

  try {
    const diff = await computeGithubDiff(projectId);
    return Response.json(diff);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not compute GitHub diff.';
    return Response.json({ error: message }, { status: 400 });
  }
}
