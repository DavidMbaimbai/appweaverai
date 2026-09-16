import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { renderBrandedEmail } from '@/lib/email-templates';

/**
 * Users at or below this many credits get a "low credits" email. The alert
 * re-arms automatically once the balance is topped back up above this
 * threshold (see `lowCreditsAlertSentAt` reset below).
 */
export const LOW_CREDITS_THRESHOLD = 20;

/** How many days before a subscription renews to send the reminder email. */
export const RENEWAL_REMINDER_DAYS_BEFORE = 3;

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
    process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, '') ||
    'https://appweaverai.com'
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

async function sendLowCreditsEmail(user: {
  id: string;
  email: string | null;
  name: string | null;
  creditBalance: number;
}) {
  if (!user.email) return;

  const billingUrl = `${getAppUrl()}/app/billing`;

  await sendEmail({
    to: user.email,
    subject:
      user.creditBalance <= 0
        ? 'Your AppWeaver AI credits are depleted'
        : 'Your AppWeaver AI credits are running low',
    html: renderBrandedEmail({
      previewText: `You have ${user.creditBalance} credit${user.creditBalance === 1 ? '' : 's'} left.`,
      heading:
        user.creditBalance <= 0
          ? 'You&rsquo;re out of credits'
          : 'Your credits are running low',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${user.name ?? 'there'},</p>
        <p style="margin:0 0 12px;">
          ${
            user.creditBalance <= 0
              ? 'Your AI usage credit balance has reached zero. You can keep building by topping up or upgrading your plan.'
              : `You have <strong>${user.creditBalance} credit${user.creditBalance === 1 ? '' : 's'}</strong> left on your account. Once they run out, some AI actions may be paused.`
          }
        </p>
        <p style="margin:0;">Visit Billing anytime to see your current balance and plan.</p>
      `,
      ctaLabel: 'View billing',
      ctaUrl: billingUrl,
    }),
    text:
      user.creditBalance <= 0
        ? `Hi ${user.name ?? 'there'}, your AppWeaver AI credit balance has reached zero. Visit ${billingUrl} to top up or upgrade.`
        : `Hi ${user.name ?? 'there'}, you have ${user.creditBalance} credits left on AppWeaver AI. Visit ${billingUrl} to review your balance.`,
  });
}

async function sendRenewalReminderEmail(user: {
  id: string;
  email: string | null;
  name: string | null;
  creditBalance: number;
  subscriptionCurrentPeriodEnd: Date;
  daysUntilRenewal: number;
}) {
  if (!user.email) return;

  const billingUrl = `${getAppUrl()}/app/billing`;
  const renewalDateLabel = formatDate(user.subscriptionCurrentPeriodEnd);

  await sendEmail({
    to: user.email,
    subject: `Your subscription renews in ${user.daysUntilRenewal} day${user.daysUntilRenewal === 1 ? '' : 's'}`,
    html: renderBrandedEmail({
      previewText: `Renews on ${renewalDateLabel} — ${user.creditBalance} credits left.`,
      heading: 'Your subscription renews soon',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${user.name ?? 'there'},</p>
        <p style="margin:0 0 12px;">
          Your AppWeaver AI subscription will renew on <strong>${renewalDateLabel}</strong>
          (in ${user.daysUntilRenewal} day${user.daysUntilRenewal === 1 ? '' : 's'}).
        </p>
        <p style="margin:0 0 12px;">You currently have <strong>${user.creditBalance} credit${user.creditBalance === 1 ? '' : 's'}</strong> left.</p>
        <p style="margin:0;">No action is needed — this is just a heads up. You can manage or cancel your subscription anytime from Billing.</p>
      `,
      ctaLabel: 'Manage subscription',
      ctaUrl: billingUrl,
    }),
    text: `Hi ${user.name ?? 'there'}, your AppWeaver AI subscription renews on ${renewalDateLabel} (in ${user.daysUntilRenewal} days). You have ${user.creditBalance} credits left. Manage it at ${billingUrl}.`,
  });
}

export type BillingAlertsSweepResult = {
  lowCreditsEmailsSent: number;
  renewalReminderEmailsSent: number;
};

/**
 * Scans all users for two conditions and sends a one-time (per-occurrence)
 * email for each:
 *  - Credit balance at/under LOW_CREDITS_THRESHOLD (including depleted/0).
 *  - Active/trialing subscription renewing within RENEWAL_REMINDER_DAYS_BEFORE.
 *
 * Designed to be safe to run repeatedly (e.g. daily via cron) — each alert
 * tracks when it was last sent so it isn't repeated until the underlying
 * condition resolves and re-occurs (credits topped up then low again, or a
 * new billing period approaching its own renewal).
 */
export async function runBillingAlertsSweep(): Promise<BillingAlertsSweepResult> {
  let lowCreditsEmailsSent = 0;
  let renewalReminderEmailsSent = 0;

  // --- Low / depleted credits ---
  const lowCreditUsers = await prisma.user.findMany({
    where: {
      creditBalance: { lte: LOW_CREDITS_THRESHOLD },
      email: { not: null },
      lowCreditsAlertSentAt: null,
    },
    select: { id: true, email: true, name: true, creditBalance: true },
  });

  for (const user of lowCreditUsers) {
    try {
      await sendLowCreditsEmail(user);
      await prisma.user.update({
        where: { id: user.id },
        data: { lowCreditsAlertSentAt: new Date() },
      });
      lowCreditsEmailsSent += 1;
    } catch (error) {
      console.error(
        `Failed to send low-credits email to user ${user.id}:`,
        error,
      );
    }
  }

  // Re-arm the alert for anyone who topped back up above the threshold, so
  // a future drop below it sends a fresh notification.
  await prisma.user.updateMany({
    where: {
      creditBalance: { gt: LOW_CREDITS_THRESHOLD },
      lowCreditsAlertSentAt: { not: null },
    },
    data: { lowCreditsAlertSentAt: null },
  });

  // --- Upcoming renewal reminder ---
  const reminderWindowEnd = new Date(
    Date.now() + RENEWAL_REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000,
  );

  const renewingUsers = await prisma.user.findMany({
    where: {
      subscriptionStatus: { in: ['active', 'trialing'] },
      email: { not: null },
      subscriptionCurrentPeriodEnd: {
        not: null,
        lte: reminderWindowEnd,
        gt: new Date(),
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      creditBalance: true,
      subscriptionCurrentPeriodEnd: true,
      renewalReminderSentForEnd: true,
    },
  });

  for (const user of renewingUsers) {
    const periodEnd = user.subscriptionCurrentPeriodEnd;
    if (!periodEnd) continue;

    // Already reminded for this exact billing period end — skip until it
    // changes (renewal happened or plan changed).
    if (
      user.renewalReminderSentForEnd &&
      user.renewalReminderSentForEnd.getTime() === periodEnd.getTime()
    ) {
      continue;
    }

    const daysUntilRenewal = Math.max(
      0,
      Math.ceil((periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );

    try {
      await sendRenewalReminderEmail({
        id: user.id,
        email: user.email,
        name: user.name,
        creditBalance: user.creditBalance,
        subscriptionCurrentPeriodEnd: periodEnd,
        daysUntilRenewal,
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { renewalReminderSentForEnd: periodEnd },
      });
      renewalReminderEmailsSent += 1;
    } catch (error) {
      console.error(
        `Failed to send renewal reminder email to user ${user.id}:`,
        error,
      );
    }
  }

  return { lowCreditsEmailsSent, renewalReminderEmailsSent };
}
