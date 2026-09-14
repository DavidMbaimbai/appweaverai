import { headers } from 'next/headers';

import { recordAuditLog } from '@/lib/admin/audit';

/**
 * Best-effort IP resolution for regular (non-admin) user activity, mirroring
 * the pattern already used across lib/admin/actions/*.ts. Only used for
 * informational display in the audit log, never for security enforcement.
 */
export async function getRequestIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export function getIpFromRequest(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
    null
  );
}

type UserActivityInput = {
  userId: string;
  userEmail?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
};

/**
 * Records a general end-user activity (project lifecycle, AI generation
 * requests, deployments, billing, account changes, etc.) into the same
 * immutable AdminAuditLog table used for privileged admin actions, so all
 * system activity is visible in one place (Admin Console → Audit Logs) and
 * can be aggregated for the Analytics dashboard.
 *
 * Best-effort: a logging failure must never block the user-facing action.
 */
export async function recordUserActivity(input: UserActivityInput) {
  await recordAuditLog({
    adminId: input.userId,
    adminEmail: input.userEmail ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    before: input.before,
    after: input.after,
    ipAddress: input.ipAddress ?? null,
  });
}
