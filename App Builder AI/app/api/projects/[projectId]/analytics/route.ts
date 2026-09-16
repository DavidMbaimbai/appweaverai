import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { hasProjectAccess } from '@/lib/projects/access';
import { getProjectAnalyticsSummary } from '@/lib/queries/project-analytics';

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

  const allowed = await hasProjectAccess(projectId, userId);
  if (!allowed) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const summary = await getProjectAnalyticsSummary(projectId);
  return Response.json(summary);
}
