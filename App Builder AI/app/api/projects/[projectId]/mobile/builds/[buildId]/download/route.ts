import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { getBuildArtifact } from '@/lib/mobile/service';
import { requireProjectCapability } from '@/lib/team/access';

export async function GET(_request: Request, context: { params: Promise<{ projectId: string; buildId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  const { projectId, buildId } = await context.params;

  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await requireProjectCapability(userId, projectId, 'view_project');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const build = await getBuildArtifact(projectId, buildId);
  if (!build?.artifactData) return NextResponse.json({ error: 'No downloadable artifact for this build.' }, { status: 404 });

  const name = (build.artifactName ?? 'mobile-bundle.zip').replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(Buffer.from(build.artifactData), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      ...(build.artifactSha256 ? { 'X-Content-SHA256': build.artifactSha256 } : {}),
    },
  });
}
