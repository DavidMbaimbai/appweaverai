import { NextRequest, NextResponse } from 'next/server';

/**
 * All pages/features are publicly browsable without signing in. Authentication
 * is only enforced at the point of actually using credits — e.g. creating a
 * project, generating artifacts, or publishing — which is handled inside the
 * relevant server actions (see lib/actions/projects.ts, artifacts.ts,
 * publish.ts), not here.
 */
export async function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)',
  ],
};
