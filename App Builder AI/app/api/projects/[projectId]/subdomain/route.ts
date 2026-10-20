import { z } from 'zod';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import {
  getProjectSubdomain,
  removeProjectSubdomain,
  setProjectSubdomain,
} from '@/lib/domains/subdomain-store';
import { getAppRootDomain } from '@/lib/domains/subdomain';
import { requireProjectAccess } from '@/lib/hosting/api-auth';
import { prisma } from '@/lib/prisma';

type Context = { params: Promise<{ projectId: string }> };

const setSchema = z.object({ subdomain: z.string().trim().min(1) });

export async function GET(_request: Request, context: Context) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true },
  });

  return Response.json({
    subdomain: await getProjectSubdomain(projectId),
    rootDomain: getAppRootDomain(),
    suggestion: project?.slug ?? null,
  });
}

export async function PUT(request: Request, context: Context) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const parsed = setSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Enter a subdomain.' }, { status: 400 });
  }

  const result = await setProjectSubdomain(projectId, parsed.data.subdomain);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  await recordUserActivity({
    userId: access.userId,
    action: 'project.subdomain_set',
    targetType: 'Project',
    targetId: projectId,
    after: { subdomain: result.value },
  });

  return Response.json({
    success: true,
    subdomain: { subdomain: result.value, host: result.host },
  });
}

export async function DELETE(_request: Request, context: Context) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  await removeProjectSubdomain(projectId);
  await recordUserActivity({
    userId: access.userId,
    action: 'project.subdomain_removed',
    targetType: 'Project',
    targetId: projectId,
  });

  return Response.json({ success: true });
}
