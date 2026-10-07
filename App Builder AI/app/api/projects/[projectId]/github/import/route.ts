import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { prisma } from '@/lib/prisma';
import { importRepoIntoProject } from '@/lib/project-github-import';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

const importSchema = z.object({
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  branch: z.string().trim().min(1).optional(),
  artifactId: z.string().trim().min(1),
});

export async function POST(
  request: Request,
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

  const json = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid import request.' }, { status: 400 });
  }

  const artifact = await prisma.artifact.findFirst({
    where: { id: parsed.data.artifactId, projectId },
    select: { id: true, slug: true },
  });
  if (!artifact) {
    return Response.json({ error: 'Artifact not found.' }, { status: 404 });
  }

  try {
    const result = await importRepoIntoProject({
      projectId,
      artifactId: artifact.id,
      artifactSlug: artifact.slug,
      userId,
      owner: parsed.data.owner,
      repo: parsed.data.repo,
      branch: parsed.data.branch,
    });

    await recordUserActivity({
      userId,
      action: 'project.github_imported',
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
      error instanceof Error ? error.message : 'Could not import from GitHub.';
    return Response.json({ error: message }, { status: 400 });
  }
}
