import { prisma } from '@/lib/prisma';
import { processNewReview } from '@/lib/project-reviews/service';
import { findPublicProject, json, limited, CORS_HEADERS } from '@/lib/project-reviews/public-api';
import { looksLikeSpam, reviewSubmitSchema } from '@/lib/project-reviews/validate';

type Ctx = { params: Promise<{ projectId: string }> };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Published reviews only; never exposes author emails. */
export async function GET(request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const limit = await limited(request, 'reviews-get', projectId, 60, 60_000);
  if (limit) return limit;

  if (!(await findPublicProject(projectId))) return json({ error: 'Project not found.' }, 404);

  const reviews = await prisma.projectReview.findMany({
    where: { projectId, status: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, rating: true, authorName: true, body: true, reply: true, replyStatus: true, createdAt: true },
  });
  return json(
    {
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        authorName: r.authorName,
        body: r.body,
        reply: r.replyStatus === 'SENT' ? r.reply : null,
        createdAt: r.createdAt,
      })),
    },
    200,
    { 'cache-control': 'public, max-age=30' },
  );
}

export async function POST(request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const limit = await limited(request, 'reviews-post', projectId, 3, 60 * 60_000);
  if (limit) return limit;

  const project = await findPublicProject(projectId);
  if (!project) return json({ error: 'Project not found.' }, 404);

  const settings = await prisma.projectReviewSettings.findUnique({
    where: { projectId },
    select: { enabled: true },
  });
  if (!settings?.enabled) return json({ error: 'Reviews are not enabled for this app.' }, 403);

  const parsed = reviewSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Please provide a rating (1-5), your name and a short review.' }, 400);
  const input = parsed.data;

  // Pretend success to bots so they get no signal.
  if (looksLikeSpam(input)) return json({ success: true });

  const duplicate = await prisma.projectReview.findFirst({
    where: {
      projectId,
      body: input.body,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    select: { id: true },
  });
  if (duplicate) return json({ success: true });

  const review = await prisma.projectReview.create({
    data: {
      projectId,
      rating: input.rating,
      authorName: input.authorName,
      authorEmail: input.authorEmail || null,
      body: input.body,
      status: 'PUBLISHED',
    },
    select: { id: true },
  });
  await processNewReview(review.id);
  return json({ success: true });
}
