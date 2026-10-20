import { NextResponse } from 'next/server';

import { getCachedSession } from '@/lib/auth/cached';
import { calendarStatus } from '@/lib/calendar/service';
import { prisma } from '@/lib/prisma';

type Ctx = { params: Promise<{ projectId: string }> };

/** Owner-only calendar status; reports UNAVAILABLE until credentials exist and a live verification passed. */
export async function GET(_request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, OR: [{ createdById: userId }, { workspace: { ownerId: userId } }] },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await calendarStatus(projectId), { headers: { 'cache-control': 'no-store' } });
}
