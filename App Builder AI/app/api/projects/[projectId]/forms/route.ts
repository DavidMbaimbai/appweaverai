import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { listFormSubmissions } from '@/lib/forms/project-form-submissions';

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

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
    notificationEmail: true,
  });
  if (!project) {
    return Response.json({ error: 'Project not found.' }, { status: 404 });
  }

  const submissions = await listFormSubmissions(projectId);
  return Response.json({
    notificationEmail: project.notificationEmail ?? '',
    submissions: submissions.map((submission) => ({
      id: submission.id,
      formName: submission.formName,
      data: submission.data,
      createdAt: submission.createdAt.toISOString(),
    })),
  });
}
