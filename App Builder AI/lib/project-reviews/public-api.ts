import { prisma } from '@/lib/prisma';
import { limitOrResponse, clientIp } from '@/lib/rate-limit';

/** Public endpoints only work for live, non-suspended projects. */
export async function findPublicProject(projectId: string) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      adminStatus: 'ACTIVE',
      deployments: { some: { isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' } },
    },
    select: { id: true, name: true },
  });
}

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

export async function limited(request: Request, scope: string, projectId: string, limit: number, windowMs: number) {
  const res = await limitOrResponse(`${scope}:${projectId}:${clientIp(request)}`, limit, windowMs);
  if (!res) return null;
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}
