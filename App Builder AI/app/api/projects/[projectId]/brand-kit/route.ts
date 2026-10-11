import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import {
  getProjectBrandKit,
  updateProjectBrandKit,
} from '@/lib/brand-kit/project-brand-kit';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

const updateSchema = z.object({
  logoUrl: z.string().trim().max(2000).optional().nullable(),
  primaryColor: z.string().trim().max(32).optional().nullable(),
  secondaryColor: z.string().trim().max(32).optional().nullable(),
  accentColor: z.string().trim().max(32).optional().nullable(),
  fontFamily: z.string().trim().max(200).optional().nullable(),
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

  const brandKit = await getProjectBrandKit(projectId);
  return Response.json({ brandKit });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const json = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid brand kit values.' }, { status: 400 });
  }

  const brandKit = await updateProjectBrandKit(projectId, {
    logoUrl: parsed.data.logoUrl ?? null,
    primaryColor: parsed.data.primaryColor ?? null,
    secondaryColor: parsed.data.secondaryColor ?? null,
    accentColor: parsed.data.accentColor ?? null,
    fontFamily: parsed.data.fontFamily ?? null,
  });

  await recordUserActivity({
    userId: access.userId,
    action: 'project.brand_kit_updated',
    targetType: 'Project',
    targetId: projectId,
  });

  return Response.json({ success: true, brandKit });
}
