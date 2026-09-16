import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import {
  sendLoginIssueReminderEmail,
  sendSignupReminderEmail,
} from '@/lib/auth/lifecycle-emails';

/**
 * Scheduled endpoint that reminds users who started but never finished
 * signing up (email verification) or resetting their password, 30 minutes
 * after they started. Trigger this every few minutes via Vercel Cron (see
 * vercel.json) or any external scheduler, authenticated with CRON_SECRET.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
  } else {
    console.warn(
      '[cron/auth-reminders] CRON_SECRET is not set — endpoint is unauthenticated.',
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 500 },
    );
  }

  try {
    const due = await prisma.pendingAuthReminder.findMany({
      where: {
        resolvedAt: null,
        reminderSentAt: null,
        remindAfter: { lte: new Date() },
      },
      take: 200,
    });

    let signupRemindersSent = 0;
    let loginIssueRemindersSent = 0;

    for (const reminder of due) {
      try {
        if (reminder.kind === 'SIGNUP') {
          // Skip if the user already verified through some other path.
          const user = await prisma.user.findUnique({
            where: { email: reminder.email },
            select: { emailVerified: true },
          });

          if (user?.emailVerified) {
            await prisma.pendingAuthReminder.update({
              where: { id: reminder.id },
              data: { resolvedAt: new Date() },
            });
            continue;
          }

          await sendSignupReminderEmail({ email: reminder.email });
          signupRemindersSent += 1;
        } else {
          await sendLoginIssueReminderEmail({ email: reminder.email });
          loginIssueRemindersSent += 1;
        }

        await prisma.pendingAuthReminder.update({
          where: { id: reminder.id },
          data: { reminderSentAt: new Date() },
        });
      } catch (error) {
        console.error(
          `[cron/auth-reminders] failed to process reminder ${reminder.id}:`,
          error,
        );
      }
    }

    return NextResponse.json({
      success: true,
      signupRemindersSent,
      loginIssueRemindersSent,
    });
  } catch (error) {
    console.error('[cron/auth-reminders] sweep failed:', error);
    return NextResponse.json(
      { error: 'Auth reminders sweep failed.' },
      { status: 500 },
    );
  }
}
