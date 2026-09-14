import { prisma } from '@/lib/prisma';
import { recordAuditLog } from '@/lib/admin/audit';
import { recordSecurityEvent } from '@/lib/admin/security-events';

/**
 * Records regular user authentication activity (sign-up / sign-in) so it
 * shows up in the Admin Console's Audit Logs (ADM-090) and Security Events
 * (ADM-091) views, not just privileged admin actions. Best-effort: never
 * throws, since it must not block the auth flow itself.
 */
export async function recordAuthActivity(input: {
  userId: string;
  event: 'signup' | 'login';
  ipAddress?: string | null;
}) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });

    const label = input.event === 'signup' ? 'signed up' : 'signed in';

    await recordAuditLog({
      adminId: input.userId,
      adminEmail: user?.email ?? null,
      action: input.event === 'signup' ? 'auth.signup' : 'auth.login',
      targetType: 'User',
      targetId: input.userId,
      result: 'SUCCESS',
      ipAddress: input.ipAddress ?? null,
    });

    await recordSecurityEvent({
      type: 'LOGIN_SUCCESS',
      severity: 'INFO',
      subjectType: 'User',
      subjectId: input.userId,
      message: `${user?.email ?? input.userId} ${label}`,
      ipAddress: input.ipAddress ?? null,
    });
  } catch (error) {
    console.error('Failed to record auth activity:', error);
  }
}
