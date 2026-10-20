import { requireProjectAccess } from '@/lib/hosting/api-auth';
import { prisma } from '@/lib/prisma';
import { reviewsToCsv } from '@/lib/project-reviews/export';

/** Owner-only CSV download of every review for this project. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;

  const reviews = await prisma.projectReview.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 20_000,
  });
  return new Response(reviewsToCsv(reviews), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="reviews.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
