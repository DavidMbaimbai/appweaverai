import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { authorizePreviewAccess } from '@/lib/preview/access';
import { serveLiveFile } from '@/lib/preview/serve-live';
import {
  serveArtifactFile,
  serveArtifactIndex,
} from '@/lib/preview/serve-preview';
import { normalizeRelativePath } from '@/lib/project-files';

/**
 * Serves the published (frozen) version of a website. Edits made after the
 * last publish stay in the editor until "Publish updates" is clicked.
 */
export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      projectId: string;
      artifactSlug: string;
      path?: string[];
    }>;
  },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const {
    projectId,
    artifactSlug,
    path: pathSegments = [],
  } = await context.params;
  const access = await authorizePreviewAccess(
    projectId,
    session?.user?.id ?? null,
  );

  if (!access.allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const relativePath =
    pathSegments.length > 0
      ? pathSegments.map(normalizeRelativePath).join('/')
      : 'index.html';

  try {
    let served = await serveLiveFile(projectId, artifactSlug, relativePath);
    // Sites published before snapshots existed (and bundled React sites)
    // fall back to the working files.
    if (!served) {
      served =
        relativePath === 'index.html'
          ? await serveArtifactIndex(projectId, artifactSlug)
          : await serveArtifactFile(projectId, artifactSlug, relativePath);
    }
    return new NextResponse(served.body, {
      headers: {
        'Content-Type': served.contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }
}
