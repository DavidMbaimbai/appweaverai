import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasProjectAccess } from '@/lib/projects/access';
import { buildProjectZip } from '@/lib/export/project-bundle';
import {
  buildBundledPreviewHtml,
  bundleArtifact,
} from '@/lib/preview/bundle-artifact';
import { resolveProjectStack } from '@/lib/preview/detect-preview-mode';
import { artifactWorkspaceDir } from '@/lib/preview/list-workspace-paths';
import { stripPreviewBaseHref } from '@/lib/project-files';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; artifactSlug: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  const { projectId, artifactSlug } = await context.params;

  if (!userId || !(await hasProjectAccess(projectId, userId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [project, { stack, relativePaths }] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    }),
    resolveProjectStack(projectId, artifactSlug),
  ]);

  if (relativePaths.length === 0) {
    return NextResponse.json(
      { error: 'Nothing to download yet — ask the agent to build it first.' },
      { status: 404 },
    );
  }

  const root = artifactWorkspaceDir(projectId, artifactSlug);
  const files: Record<string, Uint8Array> = {};
  for (const relativePath of relativePaths) {
    files[relativePath] = await readFile(path.join(root, relativePath));
  }

  let builtFrontend: { indexHtml: string; bundleJs: string } | undefined;
  if (stack !== 'static') {
    try {
      const bundleJs = await bundleArtifact({
        projectId,
        artifactSlug,
        relativePaths,
        stack,
      });
      const html = await buildBundledPreviewHtml({
        projectId,
        artifactSlug,
        bundleUrl: 'app.bundle.js',
        stack,
      });
      builtFrontend = { indexHtml: stripPreviewBaseHref(html), bundleJs };
    } catch {
      return NextResponse.json(
        { error: 'The frontend failed to bundle. Ask the agent to fix it first.' },
        { status: 422 },
      );
    }
  }

  const zip = buildProjectZip({
    projectName: project?.name ?? artifactSlug,
    files,
    builtFrontend,
  });

  return new Response(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${artifactSlug}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
