'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import type { FeedbackStatus } from '@/lib/generated/prisma/client';
import { sendEmail } from '@/lib/email';
import { renderBrandedEmail } from '@/lib/email-templates';
import { translateFromEnglish } from '@/lib/translate';

type ActionResult = { success: true } | { error: string };

/**
 * Lets an admin (with feedback:write) reply to a user's feedback message.
 * The response is shown back to the user in their in-app feedback widget.
 */
export async function respondToFeedbackAction(
  id: string,
  response: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('feedback:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const trimmed = response.trim();
  if (!trimmed) return { error: 'Please write a response before sending.' };

  const before = await prisma.feedbackMessage.findUnique({ where: { id } });
  if (!before) return { error: 'Feedback message not found.' };

  // If the original message was in a non-English language, auto-translate
  // the admin's (English) reply back into that language for the user.
  const translatedResponse =
    before.language && before.language.toLowerCase() !== 'english'
      ? await translateFromEnglish(trimmed, before.language)
      : null;

  await prisma.feedbackMessage.update({
    where: { id },
    data: {
      response: trimmed,
      translatedResponse,
      respondedAt: new Date(),
      respondedBy: auth.admin.email ?? auth.admin.id,
      status: 'RESOLVED',
    },
  });

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'feedback.responded',
    targetType: 'FeedbackMessage',
    targetId: id,
    before: { response: before.response },
    after: { response: trimmed, translatedResponse },
  });

  if (before.userEmail) {
    const replyForUser = translatedResponse ?? trimmed;
    await sendEmail({
      to: before.userEmail,
      subject: 'AppWeaver AI replied to your feedback',
      html: renderBrandedEmail({
        previewText: replyForUser.slice(0, 100),
        heading: "We've replied to your feedback",
        bodyHtml: `
          <p style="margin:0 0 4px;color:#696c74;font-size:13px;">Your message:</p>
          <div style="margin-bottom:14px;padding:14px 16px;border-radius:14px;background:#faf6f1;white-space:pre-wrap;color:#696c74;">${escapeHtml(before.message)}</div>
          <p style="margin:0 0 4px;color:#696c74;font-size:13px;">Our reply${translatedResponse ? ` (${escapeHtml(before.language ?? '')})` : ''}:</p>
          <div style="padding:14px 16px;border-radius:14px;background:#fff1ea;white-space:pre-wrap;">${escapeHtml(replyForUser)}</div>
        `,
        ctaLabel: 'Open AppWeaver AI',
        ctaUrl: `${process.env.BETTER_AUTH_URL ?? ''}/app`,
      }),
      text: `We replied to your feedback:\n\n${replyForUser}`,
    }).catch((error) => console.error('Failed to send feedback reply email:', error));
  }

  revalidatePath('/admin/feedback');
  return { success: true };
}

/** Lets an admin mark a feedback message as read/resolved without replying. */
export async function updateFeedbackStatusAction(
  id: string,
  status: FeedbackStatus,
): Promise<ActionResult> {
  const auth = await requireAdmin('feedback:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const before = await prisma.feedbackMessage.findUnique({ where: { id } });
  if (!before) return { error: 'Feedback message not found.' };

  await prisma.feedbackMessage.update({ where: { id }, data: { status } });

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'feedback.status_updated',
    targetType: 'FeedbackMessage',
    targetId: id,
    before: { status: before.status },
    after: { status },
  });

  revalidatePath('/admin/feedback');
  return { success: true };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}