'use server';

import { recordAuditLog } from '@/lib/admin/audit';
import { sendEmail } from '@/lib/email';
import { renderBrandedEmail } from '@/lib/email-templates';

const SALES_NOTIFICATION_EMAIL =
  process.env.SALES_NOTIFICATION_EMAIL ?? 'david.mbaimbai@appweaverai.com';

type ActionResult = { success: true } | { error: string };

type SalesInquiryInput = {
  name: string;
  email: string;
  company?: string;
  teamSize?: string;
  message: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Public "Contact Sales" form (app/contact-sales/page.tsx). No sign-in
 * required — anyone evaluating AppWeaver AI for their team can reach out.
 * Emails the sales inbox directly rather than only offering a mailto link,
 * so the message is guaranteed to arrive with consistent branding.
 */
export async function submitSalesInquiryAction(
  input: SalesInquiryInput,
): Promise<ActionResult> {
  const name = input.name.trim();
  const email = input.email.trim();
  const company = input.company?.trim() || null;
  const teamSize = input.teamSize?.trim() || null;
  const message = input.message.trim();

  if (!name) return { error: 'Please tell us your name.' };
  if (!EMAIL_RE.test(email)) return { error: 'Please enter a valid email address.' };
  if (!message) return { error: 'Please add a short message.' };
  if (message.length > 4000) {
    return { error: 'Message is too long (max 4000 characters).' };
  }

  try {
    await sendEmail({
      to: SALES_NOTIFICATION_EMAIL,
      subject: `New sales inquiry from ${name}${company ? ` (${company})` : ''}`,
      html: renderBrandedEmail({
        previewText: `New sales inquiry from ${name}`,
        heading: 'New sales inquiry',
        bodyHtml: `
          <p style="margin:0 0 4px;color:#696c74;font-size:13px;">Name</p>
          <p style="margin:0 0 12px;">${escapeHtml(name)}</p>
          <p style="margin:0 0 4px;color:#696c74;font-size:13px;">Email</p>
          <p style="margin:0 0 12px;"><a href="mailto:${escapeHtml(email)}" style="color:#ff3c00;">${escapeHtml(email)}</a></p>
          ${company ? `<p style="margin:0 0 4px;color:#696c74;font-size:13px;">Company</p><p style="margin:0 0 12px;">${escapeHtml(company)}</p>` : ''}
          ${teamSize ? `<p style="margin:0 0 4px;color:#696c74;font-size:13px;">Team size</p><p style="margin:0 0 12px;">${escapeHtml(teamSize)}</p>` : ''}
          <p style="margin:0 0 4px;color:#696c74;font-size:13px;">Message</p>
          <div style="padding:16px 18px;border-radius:14px;background:#faf6f1;white-space:pre-wrap;">${escapeHtml(message)}</div>
        `,
        ctaLabel: 'Reply to inquiry',
        ctaUrl: `mailto:${email}`,
      }),
      text: `New sales inquiry from ${name} (${email})${company ? ` at ${company}` : ''}${teamSize ? `, team size: ${teamSize}` : ''}:\n\n${message}`,
    });
  } catch (error) {
    console.error('Failed to send sales inquiry email:', error);
    return { error: 'Something went wrong sending your message. Please try again.' };
  }

  await recordAuditLog({
    adminId: null,
    adminEmail: email,
    action: 'sales.inquiry_submitted',
    targetType: 'SalesInquiry',
    after: { name, email, company, teamSize, message },
  });

  return { success: true };
}
