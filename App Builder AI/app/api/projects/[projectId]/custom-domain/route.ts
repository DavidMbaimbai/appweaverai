import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import {
  getProjectCustomDomain,
  removeProjectCustomDomain,
  setProjectCustomDomain,
} from '@/lib/domains/custom-domain';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

const setSchema = z.object({
  domain: z.string().trim().min(1),
});

async function requireProjectAccess(
  projectId: string,
): Promise<{ userId: string } | { error: Response }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const project = await getAccessibleProject(projectId, userId, { id: true });
  if (!project) {
    return { error: Response.json({ error: 'Project not found.' }, { status: 404 }) };
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

  const record = await getProjectCustomDomain(projectId);
  return Response.json({ domain: record });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const json = await request.json().catch(() => null);
  const parsed = setSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Enter a domain to connect.' }, { status: 400 });
  }

  try {
    const record = await setProjectCustomDomain(projectId, parsed.data.domain);
    await recordUserActivity({
      userId: access.userId,
      action: 'project.custom_domain_set',
      targetType: 'Project',
      targetId: projectId,
      after: { domain: record.domain },
    });
    return Response.json({ success: true, domain: record });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not save this domain.';
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

  await removeProjectCustomDomain(projectId);
  await recordUserActivity({
    userId: access.userId,
    action: 'project.custom_domain_removed',
    targetType: 'Project',
    targetId: projectId,
  });

  return Response.json({ success: true });
}
