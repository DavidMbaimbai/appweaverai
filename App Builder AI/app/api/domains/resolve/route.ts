import { resolvePublishedPathForDomain } from '@/lib/domains/custom-domain';

/**
 * Internal lookup used by middleware.ts to map a verified custom domain's
 * Host header to the internal published-project path it should rewrite to.
 * Runs in the Node runtime (unlike middleware, which is Edge) so it can use
 * Prisma directly.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const domain = url.searchParams.get('domain');

  if (!domain) {
    return Response.json({ path: null }, { status: 400 });
  }

  const path = await resolvePublishedPathForDomain(domain);
  return Response.json({ path });
}
