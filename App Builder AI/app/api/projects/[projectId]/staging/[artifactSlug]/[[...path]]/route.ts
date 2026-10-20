import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { authorizeStagingAccess } from '@/lib/hosting/staging';
import {
  STAGING_HEADERS,
  STAGING_TOKEN_PARAM,
  stagingCookieName,
} from '@/lib/hosting/staging-core';
import { serveLiveFile } from '@/lib/preview/serve-live';
import { normalizeRelativePath } from '@/lib/project-files';

/**
 * Serves the frozen STAGING snapshot. Access is limited to project members
 * or holders of the share token (query `?token=` once, then a cookie). Every
 * response is marked noindex.
 */
export async function GET(
  request: NextRequest,
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

  const queryToken = request.nextUrl.searchParams.get(STAGING_TOKEN_PARAM);
  const access = await authorizeStagingAccess(projectId, session?.user?.id ?? null, {
    query: queryToken,
    cookie: request.cookies.get(stagingCookieName(projectId))?.value,
  });

  if (!access.allowed) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404, headers: STAGING_HEADERS },
    );
  }

  const relativePath =
    pathSegments.length > 0
      ? pathSegments.map(normalizeRelativePath).join('/')
      : 'index.html';

  try {
    const served = await serveLiveFile(
      projectId,
      artifactSlug,
      relativePath,
      'STAGING',
    );
    if (!served) {
      return NextResponse.json(
        { error: 'File not found.' },
        { status: 404, headers: STAGING_HEADERS },
      );
    }
    const response = new NextResponse(served.body, {
      headers: { 'Content-Type': served.contentType, ...STAGING_HEADERS },
    });
    if (access.via === 'query' && queryToken) {
      response.cookies.set(stagingCookieName(projectId), queryToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    return response;
  } catch {
    return NextResponse.json(
      { error: 'File not found.' },
      { status: 404, headers: STAGING_HEADERS },
    );
  }
}
