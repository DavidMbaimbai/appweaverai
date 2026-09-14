import { prisma } from '@/lib/prisma';

export type FeedbackFilters = {
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function listFeedbackMessages(filters: FeedbackFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 30;

  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;

  const [messages, total, byStatus] = await Promise.all([
    prisma.feedbackMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.feedbackMessage.count({ where }),
    prisma.feedbackMessage.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  return { messages, total, page, pageSize, byStatus };
}

export async function listProductReviews(page = 1, pageSize = 20) {
  const [reviews, total, aggregate] = await Promise.all([
    prisma.productReview.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.productReview.count(),
    prisma.productReview.aggregate({ _avg: { rating: true } }),
  ]);

  return {
    reviews,
    total,
    page,
    pageSize,
    averageRating: aggregate._avg.rating ?? null,
  };
}
