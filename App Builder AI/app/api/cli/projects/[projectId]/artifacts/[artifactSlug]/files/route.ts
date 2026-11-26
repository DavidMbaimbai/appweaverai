import { z } from 'zod';
import { NextResponse } from 'next/server';

import { getCliSessionUser } from '@/lib/cli-auth';
import { deleteProjectFile, normalizeRelativePath, writeProjectFile } from '@/lib/project-files';
import { hasProjectAccess } from '@/lib/projects/access';
import { prisma } from '@/lib/prisma';
import { clientIp, limitOrResponse } from '@/lib/rate-limit';
import { recordUserActivity } from '@/lib/activity/record-user-activity';

const fileSchema = z.object({
  path: z.string().trim().min(1).max(512),
  content: z.string().max(5_000_000),
  baseUpdatedAt: z.string().datetime().nullable().optional(),
});

const bodySchema = z.object({
  files: z.array(fileSchema).max(200),
  deletedPaths: z.array(
    z.object({
      path: z.string().trim().min(1).max(512),
      baseUpdatedAt: z.string().datetime(),
    }),
  ).max(200).default([]),
});

type RouteContext = {
  params: Promise<{ projectId: string; artifactSlug: string }>;
};

async function authorize(request: Request, projectId: string) {
  const user = await getCliSessionUser(request.headers.get('authorization'));
  if (!user || !(await hasProjectAccess(projectId, user.id))) return null;
  return user;
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId, artifactSlug } = await context.params;
  const limited = await limitOrResponse(`cli-files-read:${clientIp(request)}`, 60, 60_000);
  if (limited) return limited;

  if (!(await authorize(request, projectId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const files = await prisma.projectFile.findMany({
    where: { projectId, path: { startsWith: `${artifactSlug}/` } },
    orderBy: { path: 'asc' },
    select: { path: true, sizeBytes: true, mimeType: true, updatedAt: true },
  });

  return NextResponse.json({
    files: files.map((file) => ({
      path: file.path.slice(`${artifactSlug}/`.length),
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      updatedAt: file.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, artifactSlug } = await context.params;
  const limited = await limitOrResponse(`cli-files-write:${clientIp(request)}`, 30, 60_000);
  if (limited) return limited;

  const user = await authorize(request, projectId);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const artifact = await prisma.artifact.findFirst({
    where: { projectId, slug: artifactSlug },
    select: { id: true },
  });
  if (!artifact) {
    return NextResponse.json({ error: 'Artifact not found.' }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid file update request.' }, { status: 400 });
  }

  const requestedPaths = [
    ...parsed.data.files.map((file) => file.path),
    ...parsed.data.deletedPaths.map((file) => file.path),
  ].map(normalizeRelativePath);
  if (requestedPaths.some((filePath) => !filePath)) {
    return NextResponse.json({ error: 'Invalid file path.' }, { status: 400 });
  }

  const dbPaths = requestedPaths.map((filePath) => `${artifactSlug}/${filePath}`);
  const currentFiles = await prisma.projectFile.findMany({
    where: { projectId, path: { in: dbPaths } },
    select: { path: true, updatedAt: true },
  });
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));

  const conflicts: string[] = [];
  for (const file of parsed.data.files) {
    const path = normalizeRelativePath(file.path);
    const current = currentByPath.get(`${artifactSlug}/${path}`);
    const expected = file.baseUpdatedAt ?? null;
    if ((current?.updatedAt.toISOString() ?? null) !== expected) conflicts.push(path);
  }
  for (const file of parsed.data.deletedPaths) {
    const path = normalizeRelativePath(file.path);
    const current = currentByPath.get(`${artifactSlug}/${path}`);
    if (!current || current.updatedAt.toISOString() !== file.baseUpdatedAt) {
      conflicts.push(path);
    }
  }

  if (conflicts.length > 0) {
    return NextResponse.json(
      { error: 'Remote files changed. Pull before uploading.', conflicts },
      { status: 409 },
    );
  }

  for (const file of parsed.data.files) {
    await writeProjectFile({
      projectId,
      artifactSlug,
      artifactId: artifact.id,
      relativePath: file.path,
      content: file.content,
    });
  }
  for (const file of parsed.data.deletedPaths) {
    await deleteProjectFile({
      projectId,
      artifactSlug,
      relativePath: file.path,
    });
  }

  await recordUserActivity({
    userId: user.id,
    action: 'project.files_synced_from_ide',
    targetType: 'Project',
    targetId: projectId,
    after: {
      artifactSlug,
      updated: parsed.data.files.length,
      deleted: parsed.data.deletedPaths.length,
    },
    ipAddress: clientIp(request),
  });

  return NextResponse.json({ updated: parsed.data.files.length, deleted: parsed.data.deletedPaths.length });
}
