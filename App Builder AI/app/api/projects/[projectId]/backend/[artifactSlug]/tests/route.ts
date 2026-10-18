import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { hasProjectAccess } from '@/lib/projects/access';
import { limitOrResponse } from '@/lib/rate-limit';
import { runBackendTests } from '@/lib/backend-preview/manager';

export const maxDuration = 360;

/** Runs the generated backend's test suite in a sandboxed container. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string; artifactSlug: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  const { projectId, artifactSlug } = await context.params;

  if (!userId || !(await hasProjectAccess(projectId, userId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = await limitOrResponse(`tests:${userId}`, 6, 60_000);
  if (limited) return limited;

  const result = await runBackendTests(projectId, artifactSlug);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
