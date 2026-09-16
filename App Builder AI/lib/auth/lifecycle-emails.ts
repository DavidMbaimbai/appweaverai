import { sendEmail } from '@/lib/email';
import { renderBrandedEmail } from '@/lib/email-templates';

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
    process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, '') ||
    'https://appweaverai.com'
  );
}

/** Sent once, right after a new account finishes registering. */
export async function sendWelcomeEmail({
  email,
  name,
}: {
  email: string | null | undefined;
  name: string | null | undefined;
}) {
  if (!email) return;

  const appUrl = getAppUrl();
  const displayName = name?.trim() || 'there';

  await sendEmail({
    to: email,
    subject: 'Welcome to AppWeaver AI 🎉',
    html: renderBrandedEmail({
      previewText: 'Thanks for joining AppWeaver AI — let’s build something.',
      heading: `Welcome, ${displayName}!`,
      bodyHtml: `
        <p style="margin:0 0 12px;">Thanks for creating an AppWeaver AI account — we&rsquo;re excited to see what you build.</p>
        <p style="margin:0 0 12px;">Describe an idea in plain language and our AI agent will scaffold, write, and iterate on a real, running app for you — with a live preview the whole time.</p>
        <p style="margin:0;">If you ever have questions, just reply to this email.</p>
      `,
      ctaLabel: 'Start building',
      ctaUrl: `${appUrl}/app`,
    }),
    text: `Welcome to AppWeaver AI, ${displayName}! Thanks for creating an account. Start building at ${appUrl}/app.`,
  });
}

/** Sent every time a user successfully signs in (not on sign-up — see sendWelcomeEmail). */
export async function sendLoginNotificationEmail({
  email,
  name,
  ipAddress,
  occurredAt = new Date(),
}: {
  email: string | null | undefined;
  name: string | null | undefined;
  ipAddress?: string | null;
  occurredAt?: Date;
}) {
  if (!email) return;

  const appUrl = getAppUrl();
  const displayName = name?.trim() || 'there';
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(occurredAt);

  await sendEmail({
    to: email,
    subject: 'New sign-in to your AppWeaver AI account',
    html: renderBrandedEmail({
      previewText: `New sign-in on ${dateLabel}`,
      heading: 'Successful sign-in',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hi ${displayName},</p>
        <p style="margin:0 0 12px;">We noticed a successful sign-in to your AppWeaver AI account.</p>
        <div style="margin:0 0 12px;padding:14px 16px;border-radius:12px;background:#faf6f1;font-size:13px;color:#696c74;">
          <p style="margin:0 0 4px;"><strong>Time:</strong> ${dateLabel}</p>
          ${ipAddress ? `<p style="margin:0;"><strong>IP address:</strong> ${ipAddress}</p>` : ''}
        </div>
        <p style="margin:0;">If this wasn&rsquo;t you, secure your account immediately by resetting your password.</p>
      `,
      ctaLabel: 'Review account security',
      ctaUrl: `${appUrl}/app/settings`,
    }),
    text: `Hi ${displayName}, we noticed a successful sign-in to your AppWeaver AI account at ${dateLabel}${ipAddress ? ` from ${ipAddress}` : ''}. If this wasn't you, reset your password at ${appUrl}/app/settings.`,
  });
}

/** Sent 30 minutes after a signup was started but the email was never verified. */
export async function sendSignupReminderEmail({
  email,
}: {
  email: string;
}) {
  const appUrl = getAppUrl();

  await sendEmail({
    to: email,
    subject: 'Finish setting up your AppWeaver AI account',
    html: renderBrandedEmail({
      previewText: 'You’re almost there — just verify your email to continue.',
      heading: 'Still with us?',
      bodyHtml: `
        <p style="margin:0 0 12px;">We noticed you started creating an AppWeaver AI account but haven&rsquo;t verified your email yet.</p>
        <p style="margin:0 0 12px;">It only takes a moment — head back and enter the verification code we sent, or request a new one if it expired.</p>
        <p style="margin:0;">If you didn&rsquo;t mean to sign up, feel free to ignore this email.</p>
      `,
      ctaLabel: 'Finish signing up',
      ctaUrl: `${appUrl}/`,
    }),
    text: `We noticed you started creating an AppWeaver AI account but haven't verified your email yet. Head back to ${appUrl}/ to finish, or request a new verification code.`,
  });
}

/** Sent 30 minutes after a password-reset was requested but never completed. */
export async function sendLoginIssueReminderEmail({
  email,
}: {
  email: string;
}) {
  const appUrl = getAppUrl();

  await sendEmail({
    to: email,
    subject: 'Still having trouble signing in?',
    html: renderBrandedEmail({
      previewText: 'We noticed your password reset wasn’t completed.',
      heading: 'Need a hand signing in?',
      bodyHtml: `
        <p style="margin:0 0 12px;">We noticed you started resetting your AppWeaver AI password but didn&rsquo;t finish.</p>
        <p style="margin:0 0 12px;">If you&rsquo;re still having trouble logging in, you can request a new reset code and try again.</p>
        <p style="margin:0;">If you got back in on your own, you can safely ignore this email.</p>
      `,
      ctaLabel: 'Reset password',
      ctaUrl: `${appUrl}/`,
    }),
    text: `We noticed you started resetting your AppWeaver AI password but didn't finish. Visit ${appUrl}/ to request a new reset code if you're still having trouble signing in.`,
  });
}
