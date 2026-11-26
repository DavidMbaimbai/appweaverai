import { NextResponse } from 'next/server';

import { getCliSessionUser } from '@/lib/cli-auth';
import { prisma } from '@/lib/prisma';
import { clientIp, limitOrResponse } from '@/lib/rate-limit';

/** Lists projects available to an authenticated local IDE companion. */
export async function GET(request: Request) {
  const limited = await limitOrResponse(`cli-projects:${clientIp(request)}`, 30, 60_000);
  if (limited) return limited;

  const user = await getCliSessionUser(request.headers.get('authorization'));
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      OR: [
        { createdById: user.id },
        { workspace: { ownerId: user.id } },
        { members: { some: { userId: user.id } } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      updatedAt: true,
      workspace: { select: { slug: true } },
      artifacts: {
        select: { id: true, name: true, slug: true, type: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  return NextResponse.json({
    projects: projects.map((project) => ({
      ...project,
      updatedAt: project.updatedAt.toISOString(),
      artifacts: project.artifacts.map((artifact) => ({
        ...artifact,
        updatedAt: artifact.updatedAt.toISOString(),
      })),
    })),
  });
}
