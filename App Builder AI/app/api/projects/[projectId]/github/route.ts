import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import {
  disconnectProjectGithubLink,
  exportProjectToGithub,
  getProjectGithubLink,
} from '@/lib/project-github-export';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

const exportSchema = z.object({
  repoName: z.string().trim().max(100).optional(),
  isPrivate: z.boolean().optional(),
});

async function requireProjectAccess(
  projectId: string,
): Promise<{ userId: string } | { error: Response }> {
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

  return { userId };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const link = await getProjectGithubLink(projectId);
  return Response.json({ link });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const json = await request.json().catch(() => ({}));
  const parsed = exportSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid export request.' }, { status: 400 });
  }

  try {
    const result = await exportProjectToGithub({
      projectId,
      userId: access.userId,
      repoName: parsed.data.repoName,
      isPrivate: parsed.data.isPrivate ?? true,
    });

    await recordUserActivity({
      userId: access.userId,
      action: 'project.github_exported',
      targetType: 'Project',
      targetId: projectId,
      after: {
        repo: `${result.repoOwner}/${result.repoName}`,
        fileCount: result.fileCount,
      },
    });

    return Response.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not export to GitHub.';
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  await disconnectProjectGithubLink(projectId);

  await recordUserActivity({
    userId: access.userId,
    action: 'project.github_disconnected',
    targetType: 'Project',
    targetId: projectId,
  });

  return Response.json({ success: true });
}
