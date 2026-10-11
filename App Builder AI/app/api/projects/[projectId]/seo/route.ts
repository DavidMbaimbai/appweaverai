import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import { getProjectSeo, updateProjectSeo } from '@/lib/seo/project-seo';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

const updateSchema = z.object({
  seoTitle: z.string().trim().max(120).optional().nullable(),
  seoDescription: z.string().trim().max(500).optional().nullable(),
  seoImageUrl: z.string().trim().max(2000).optional().nullable(),
  faviconUrl: z.string().trim().max(2000).optional().nullable(),
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

  const seo = await getProjectSeo(projectId);
  return Response.json({ seo });
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
    return Response.json({ error: 'Invalid SEO settings.' }, { status: 400 });
  }

  const seo = await updateProjectSeo(projectId, {
    seoTitle: parsed.data.seoTitle ?? null,
    seoDescription: parsed.data.seoDescription ?? null,
    seoImageUrl: parsed.data.seoImageUrl ?? null,
    faviconUrl: parsed.data.faviconUrl ?? null,
  });

  await recordUserActivity({
    userId: access.userId,
    action: 'project.seo_updated',
    targetType: 'Project',
    targetId: projectId,
  });

  return Response.json({ success: true, seo });
}
