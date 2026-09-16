import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null =
  null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return cachedTransporter;
}

/** Content-ID referenced by the branded email header (see email-templates.ts). */
export const BRAND_LOGO_CID = 'appweaver-logo-mark';

let cachedLogoBuffer: Buffer | null | undefined;

function getLogoAttachment() {
  if (cachedLogoBuffer === undefined) {
    try {
      cachedLogoBuffer = fs.readFileSync(
        path.join(process.cwd(), 'public', 'brand', 'logo-mark.png'),
      );
    } catch {
      cachedLogoBuffer = null;
    }
  }

  if (!cachedLogoBuffer) return null;

  return {
    filename: 'logo-mark.png',
    content: cachedLogoBuffer,
    cid: BRAND_LOGO_CID,
    contentDisposition: 'inline' as const,
  };
}

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Sends a transactional email via SMTP. Falls back to logging the email to
 * the server console when SMTP isn't configured, so local development never
 * hard-fails on a missing provider.
 *
 * The brand logo is always embedded as an inline CID attachment (rather than
 * a hosted URL) so it renders reliably regardless of environment/network
 * reachability and isn't affected by email clients blocking remote images.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      `[email] SMTP is not configured — logging email instead of sending it.\nTo: ${to}\nSubject: ${subject}\n${text ?? html}`,
    );
    return;
  }

  const logoAttachment = getLogoAttachment();

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    html,
    text,
    attachments: logoAttachment ? [logoAttachment] : undefined,
  });
}
