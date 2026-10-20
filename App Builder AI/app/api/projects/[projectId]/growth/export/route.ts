import { NextResponse } from 'next/server';

import { getCachedSession } from '@/lib/auth/cached';
import { toCsv } from '@/lib/growth-bi/csv';
import { collectProject } from '@/lib/growth-bi/project';
import { getAccessibleProject } from '@/lib/projects/access';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { projectId } = await params;
  const project = await getAccessibleProject(projectId, userId, { id: true });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const requested = Number(new URL(request.url).searchParams.get('days'));
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const to = new Date();
  const snap = await collectProject(project.id, new Date(to.getTime() - days * 86_400_000), to);
  const csv = toCsv(
    ['channel', 'views', 'visitors', 'leads', 'won', 'bookings', 'view_to_lead'],
    snap.channels.map((c) => [c.channel, c.views, c.visitors, c.leads, c.won, c.bookings, c.viewToLead ?? '']),
  );
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="project-growth-${days}d.csv"`, 'cache-control': 'no-store' },
  });
}
