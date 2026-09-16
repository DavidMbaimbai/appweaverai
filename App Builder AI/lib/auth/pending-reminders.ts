import { prisma } from '@/lib/prisma';

const REMINDER_DELAY_MS = 30 * 60 * 1000; // 30 minutes

export type AuthReminderKind = 'SIGNUP' | 'PASSWORD_RESET';

/**
 * Records (or refreshes) an in-progress signup / password-reset attempt.
 * Called whenever we send a verification / reset OTP. A cron sweep
 * (app/api/cron/auth-reminders/route.ts) later emails a reminder if the
 * matching PendingAuthReminder row is still unresolved 30 minutes later.
 */
export async function trackPendingAuthReminder(
  email: string | null | undefined,
  kind: AuthReminderKind,
) {
  if (!email) return;

  try {
    const existing = await prisma.pendingAuthReminder.findFirst({
      where: { email, kind, resolvedAt: null, reminderSentAt: null },
      select: { id: true },
    });

    const remindAfter = new Date(Date.now() + REMINDER_DELAY_MS);

    if (existing) {
      // Re-requested a code (e.g. resend) — push the reminder window out
      // instead of stacking duplicate rows.
      await prisma.pendingAuthReminder.update({
        where: { id: existing.id },
        data: { remindAfter },
      });
      return;
    }

    await prisma.pendingAuthReminder.create({
      data: { email, kind, remindAfter },
    });
  } catch (error) {
    console.error('Failed to track pending auth reminder:', error);
  }
}

/**
 * Marks any outstanding reminder(s) for this email as resolved — called
 * once the user actually finishes the flow (verifies their email, resets
 * their password, or simply signs in successfully).
 */
export async function resolvePendingAuthReminders(
  email: string | null | undefined,
  kind?: AuthReminderKind,
) {
  if (!email) return;

  try {
    await prisma.pendingAuthReminder.updateMany({
      where: {
        email,
        resolvedAt: null,
        ...(kind ? { kind } : {}),
      },
      data: { resolvedAt: new Date() },
    });
  } catch (error) {
    console.error('Failed to resolve pending auth reminder:', error);
  }
}
