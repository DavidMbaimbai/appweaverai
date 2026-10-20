import { getRequestIp } from '@/lib/activity/record-user-activity';
import { recordAuditLog } from '@/lib/admin/audit';
import { prisma } from '@/lib/prisma';

/** Audit entry for an end-user decision. Works inside and outside a request (cron, tests). */
export async function auditUserDecision(input: {
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  after?: unknown;
}) {
  const [ip, user] = await Promise.all([
    getRequestIp().catch(() => null),
    prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } }).catch(() => null),
  ]);
  await recordAuditLog({
    adminId: input.userId,
    adminEmail: user?.email ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason ?? null,
    after: input.after,
    ipAddress: ip,
  });
}
