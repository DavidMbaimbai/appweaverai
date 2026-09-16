import { NextRequest, NextResponse } from 'next/server';

/**
 * All pages/features are publicly browsable without signing in. Authentication
 * is only enforced at the point of actually using credits — e.g. creating a
 * project, generating artifacts, or publishing — which is handled inside the
 * relevant server actions (see lib/actions/projects.ts, artifacts.ts,
 * publish.ts), not here.
 *
 * This also routes requests arriving on a verified project custom domain
 * (see lib/domains/custom-domain.ts) to that project's published deployment,
 * without affecting any request to the app's own domains. This lets project
 * owners "bring their own domain" without needing separate hosting/DNS
 * infrastructure per project.
 *
 * Safety: every known/first-party host short-circuits immediately with
 * NextResponse.next() before any network call, and any error while
 * resolving an unknown host falls back to normal routing (which will 404)
 * rather than breaking the request.
 */
export async function proxy(request: NextRequest) {
  // API routes are never rewritten for custom domains (and skipping them here
  // also avoids the internal /api/domains/resolve lookup below recursing into
  // itself when it shares the same unrecognized host).
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const hostHeader = request.headers.get('host') ?? '';
  const host = hostHeader.split(':')[0]?.toLowerCase() ?? '';

  if (
    !host ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.vercel.app') ||
    host.endsWith('appweaverai.com')
  ) {
    return NextResponse.next();
  }

  try {
    const lookupUrl = new URL('/api/domains/resolve', request.url);
    lookupUrl.searchParams.set('domain', host);

    const response = await fetch(lookupUrl, {
      headers: { 'x-internal-lookup': '1' },
    });

    if (response.ok) {
      const data = (await response.json()) as { path: string | null };
      if (data.path) {
        const rewritten = request.nextUrl.clone();
        const suffix =
          request.nextUrl.pathname === '/' ? '' : request.nextUrl.pathname;
        rewritten.pathname = `${data.path}${suffix}`;
        return NextResponse.rewrite(rewritten);
      }
    }
  } catch {
    // Fail open — fall through to normal routing.
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)',
  ],
};
