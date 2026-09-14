import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasProjectAccess } from '@/lib/projects/access';
import { getCodeLanguage } from '@/lib/code-run/languages';
import { runCode } from '@/lib/code-run/run-code';

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string; artifactSlug: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, artifactSlug } = await context.params;

  const allowed = await hasProjectAccess(projectId, userId);
  if (!allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const artifact = await prisma.artifact.findFirst({
    where: { projectId, slug: artifactSlug },
    select: { codingLanguage: true },
  });

  const language = getCodeLanguage(artifact?.codingLanguage);
  if (!language) {
    return NextResponse.json(
      { error: 'This artifact is not set up as a plain-code (non-web) program.' },
      { status: 400 },
    );
  }

  try {
    const result = await runCode(projectId, artifactSlug, language.id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to run the program.',
      },
      { status: 500 },
    );
  }
}
