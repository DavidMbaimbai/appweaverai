import { prisma } from '@/lib/prisma';

export type AuditLogFilters = {
  adminId?: string;
  action?: string;
  targetType?: string;
  result?: string;
  page?: number;
  pageSize?: number;
};

export async function listAuditLogs(filters: AuditLogFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 30;

  const where: Record<string, unknown> = {};
  if (filters.adminId) where.adminId = filters.adminId;
  if (filters.action) where.action = { contains: filters.action };
  if (filters.targetType) where.targetType = filters.targetType;
  if (filters.result) where.result = filters.result;

  const [logs, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  return { logs, total, page, pageSize };
}
