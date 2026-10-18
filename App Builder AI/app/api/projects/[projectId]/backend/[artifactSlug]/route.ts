import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { hasProjectAccess } from '@/lib/projects/access';
import {
  getBackendStatus,
  startBackend,
  stopBackend,
} from '@/lib/backend-preview/manager';

type Context = {
  params: Promise<{ projectId: string; artifactSlug: string }>;
};

async function authorize(context: Context) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  const { projectId, artifactSlug } = await context.params;

  if (!userId || !(await hasProjectAccess(projectId, userId))) {
    return null;
  }
  return { projectId, artifactSlug };
}

const unauthorized = () =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function GET(_request: Request, context: Context) {
  const target = await authorize(context);
  if (!target) return unauthorized();
  return NextResponse.json(
    await getBackendStatus(target.projectId, target.artifactSlug),
  );
}

export async function POST(_request: Request, context: Context) {
  const target = await authorize(context);
  if (!target) return unauthorized();

  const result = await startBackend(target.projectId, target.artifactSlug);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(
    await getBackendStatus(target.projectId, target.artifactSlug),
  );
}

export async function DELETE(_request: Request, context: Context) {
  const target = await authorize(context);
  if (!target) return unauthorized();
  await stopBackend(target.projectId, target.artifactSlug);
  return NextResponse.json({ success: true });
}
