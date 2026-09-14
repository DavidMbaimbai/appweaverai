import { prisma } from '@/lib/prisma';
import { recordAuditLog } from '@/lib/admin/audit';
import { recordSecurityEvent } from '@/lib/admin/security-events';
import { lookupIpLocation } from '@/lib/geo/ip-lookup';

/**
 * Records regular user authentication activity (sign-up / sign-in) so it
 * shows up in the Admin Console's Audit Logs (ADM-090) and Security Events
 * (ADM-091) views, not just privileged admin actions. Best-effort: never
 * throws, since it must not block the auth flow itself.
 */
export async function recordAuthActivity(input: {
  userId: string;
  event: 'signup' | 'login' | 'logout';
  ipAddress?: string | null;
}) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });

    const label =
      input.event === 'signup'
        ? 'signed up'
        : input.event === 'logout'
          ? 'logged out'
          : 'signed in';
    const location = await lookupIpLocation(input.ipAddress);

    await recordAuditLog({
      adminId: input.userId,
      adminEmail: user?.email ?? null,
      action:
        input.event === 'signup'
          ? 'auth.signup'
          : input.event === 'logout'
            ? 'auth.logout'
            : 'auth.login',
      targetType: 'User',
      targetId: input.userId,
      after: location,
      result: 'SUCCESS',
      ipAddress: input.ipAddress ?? location?.ip ?? null,
    });

    await recordSecurityEvent({
      type: input.event === 'logout' ? 'LOGOUT' : 'LOGIN_SUCCESS',
      severity: 'INFO',
      subjectType: 'User',
      subjectId: input.userId,
      message: location
        ? `${user?.email ?? input.userId} ${label} from ${[location.city, location.country].filter(Boolean).join(', ') || 'an unknown location'}`
        : `${user?.email ?? input.userId} ${label}`,
      metadata: location,
      ipAddress: input.ipAddress ?? location?.ip ?? null,
    });
  } catch (error) {
    console.error('Failed to record auth activity:', error);
  }
}

/**
 * Records an email verification event (the 8-digit OTP code flow — see
 * components/auth/auth-modal.tsx) with an approximate geolocation of the
 * IP address that completed it. Feeds the Admin Console's Audit Logs and
 * Security Events, and the "recent verification locations" shown on the
 * public rotating-globe footer icon and the Analytics page. Best-effort:
 * never throws, since it must not block the verification flow itself.
 */
export async function recordEmailVerificationLocation(input: {
  userId: string;
  ipAddress?: string | null;
}) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });

    const location = await lookupIpLocation(input.ipAddress);

    await recordAuditLog({
      adminId: input.userId,
      adminEmail: user?.email ?? null,
      action: 'auth.email_verified',
      targetType: 'User',
      targetId: input.userId,
      after: location,
      result: 'SUCCESS',
      ipAddress: input.ipAddress ?? location?.ip ?? null,
    });

    await recordSecurityEvent({
      type: 'EMAIL_VERIFIED',
      severity: 'INFO',
      subjectType: 'User',
      subjectId: input.userId,
      message: location
        ? `${user?.email ?? input.userId} verified their email from ${[location.city, location.country].filter(Boolean).join(', ') || 'an unknown location'}`
        : `${user?.email ?? input.userId} verified their email`,
      metadata: location,
      ipAddress: input.ipAddress ?? location?.ip ?? null,
    });
  } catch (error) {
    console.error('Failed to record email verification location:', error);
  }
}
