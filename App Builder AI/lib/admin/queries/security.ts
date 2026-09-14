import { prisma } from '@/lib/prisma';

export type SecurityEventFilters = {
  severity?: string;
  type?: string;
  page?: number;
  pageSize?: number;
};

export async function listSecurityEvents(filters: SecurityEventFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 30;

  const where: Record<string, unknown> = {};
  if (filters.severity) where.severity = filters.severity;
  if (filters.type) where.type = filters.type;

  const [events, total, bySeverity] = await Promise.all([
    prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.securityEvent.count({ where }),
    prisma.securityEvent.groupBy({
      by: ['severity'],
      _count: { _all: true },
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  return { events, total, page, pageSize, bySeverity };
}
