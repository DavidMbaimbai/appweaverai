import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getAccessibleProject } from '@/lib/projects/access';
import {
  createProjectCheckpoint,
  listProjectCheckpoints,
} from '@/lib/project-checkpoints';

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

async function requireProjectAccess(
  projectId: string,
): Promise<{ userId: string } | { error: Response }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return {
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
      }),
    };
  }

  const project = await getAccessibleProject(projectId, userId, {
    id: true,
  });

  if (!project) {
    return {
      error: new Response(JSON.stringify({ error: 'Project not found.' }), {
        status: 404,
      }),
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

  const checkpoints = await listProjectCheckpoints(projectId);
  return Response.json({ checkpoints });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json({ error: 'A checkpoint label is required.' }, {
      status: 400,
    });
  }

  const checkpoint = await createProjectCheckpoint({
    projectId,
    label: parsed.data.label,
    description: parsed.data.description ?? null,
    createdById: access.userId,
    isAutomatic: false,
  });

  if (!checkpoint) {
    return Response.json(
      { error: 'This project has no files to save yet.' },
      { status: 400 },
    );
  }

  return Response.json({ success: true, checkpointId: checkpoint.id });
}
