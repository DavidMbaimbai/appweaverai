import { randomUUID } from 'crypto';

import { prisma } from '@/lib/prisma';

type AuditEntry = {
  adminId: string | null;
  adminEmail?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  result?: 'SUCCESS' | 'FAILURE';
  reason?: string | null;
  correlationId?: string;
  ipAddress?: string | null;
};

/**
 * Records an immutable audit entry for a privileged admin action (ADM-005).
 * Best-effort: a logging failure must never block the admin action itself,
 * but is surfaced to server logs so it can be investigated.
 */
export async function recordAuditLog(entry: AuditEntry) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: entry.adminId,
        adminEmail: entry.adminEmail ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        result: entry.result ?? 'SUCCESS',
        reason: entry.reason ?? null,
        correlationId: entry.correlationId ?? randomUUID(),
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to record admin audit log:', error);
  }
}

function toJson(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}
