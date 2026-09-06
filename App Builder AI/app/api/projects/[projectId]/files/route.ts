import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

async function getSessionUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

async function authorizeProject(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [
        { workspace: { ownerId: userId } },
        { workspace: { members: { some: { userId } } } },
        { members: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await context.params;
  const project = await authorizeProject(projectId, userId);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const files = await prisma.projectFile.findMany({
    where: { projectId },
    orderBy: { path: 'asc' },
    select: {
      path: true,
      sizeBytes: true,
      mimeType: true,
      updatedAt: true,
      artifactId: true,
    },
  });

  return NextResponse.json({
    files: files.map((file) => ({
      path: file.path,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      updatedAt: file.updatedAt.toISOString(),
      artifactId: file.artifactId,
    })),
  });
}
