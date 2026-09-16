import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { verifyProjectCustomDomain } from '@/lib/domains/custom-domain';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

export async function POST(
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
    const result = await verifyProjectCustomDomain(projectId);
    if (result.verified) {
      await recordUserActivity({
        userId,
        action: 'project.custom_domain_verified',
        targetType: 'Project',
        targetId: projectId,
      });
    }
    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not verify this domain.';
    return Response.json({ error: message }, { status: 400 });
  }
}
