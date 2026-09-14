'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordAuditLog } from '@/lib/admin/audit';
import { sendEmail } from '@/lib/email';
import { renderBrandedEmail, starRatingHtml } from '@/lib/email-templates';
import { detectAndTranslateToEnglish } from '@/lib/translate';

const FEEDBACK_NOTIFICATION_EMAIL =
  process.env.FEEDBACK_NOTIFICATION_EMAIL ?? 'david.mbaimbai@appweaverai.com';

type ActionResult = { success: true } | { error: string };

async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };
}

/**
 * Lets a signed-in user leave a message that's visible to the company in
 * the Admin Console's Feedback page. Best-effort audit trail entry, mirrors
 * the pattern used for auth activity (lib/auth/record-auth-activity.ts).
 */
export async function submitFeedbackMessageAction(
  message: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: 'You must be signed in to send feedback.' };

  const trimmed = message.trim();
  if (!trimmed) return { error: 'Please write a message before sending.' };
  if (trimmed.length > 4000) {
    return { error: 'Message is too long (max 4000 characters).' };
  }

  const created = await prisma.feedbackMessage.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      message: trimmed,
    },
  });

  // Best-effort: detect the message's language and, if it isn't English,
  // store an English translation so admins can read/reply without needing
  // to speak the user's language.
  const translation = await detectAndTranslateToEnglish(trimmed);
  if (translation && translation.englishTranslation) {
    await prisma.feedbackMessage.update({
      where: { id: created.id },
      data: { language: translation.language, translatedMessage: translation.englishTranslation },
    });
  }

  await recordAuditLog({
    adminId: user.id,
    adminEmail: user.email,
    action: 'feedback.message_sent',
    targetType: 'FeedbackMessage',
    targetId: created.id,
    after: { message: trimmed },
  });

  const englishForAdmin = translation?.englishTranslation ?? null;

  await sendEmail({
    to: FEEDBACK_NOTIFICATION_EMAIL,
    subject: `New feedback message from ${user.email ?? user.name ?? 'a user'}`,
    html: renderBrandedEmail({
      previewText: `New feedback: ${(englishForAdmin ?? trimmed).slice(0, 80)}`,
      heading: 'New feedback message',
      bodyHtml: `
        <p style="margin:0 0 4px;color:#696c74;font-size:13px;">From ${user.email ?? user.name ?? user.id}${translation && translation.language !== 'English' ? ` &middot; written in ${escapeHtml(translation.language)}` : ''}</p>
        <div style="margin-top:14px;padding:16px 18px;border-radius:14px;background:#faf6f1;white-space:pre-wrap;">${escapeHtml(trimmed)}</div>
        ${englishForAdmin ? `<p style="margin:14px 0 4px;color:#696c74;font-size:13px;">English translation:</p><div style="padding:16px 18px;border-radius:14px;background:#fff1ea;white-space:pre-wrap;">${escapeHtml(englishForAdmin)}</div>` : ''}
      `,
      ctaLabel: 'Reply in Admin Console',
      ctaUrl: `${process.env.BETTER_AUTH_URL ?? ''}/admin/feedback`,
    }),
    text: `New feedback from ${user.email ?? user.name ?? user.id}:\n\n${trimmed}${englishForAdmin ? `\n\nEnglish translation:\n${englishForAdmin}` : ''}`,
  }).catch((error) => console.error('Failed to send feedback notification email:', error));

  revalidatePath('/admin/feedback');
  return { success: true };
}

/**
 * Lets a signed-in user leave a star rating (1-5) with an optional comment.
 */
export async function submitProductReviewAction(
  rating: number,
  comment?: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: 'You must be signed in to leave a review.' };

  const normalizedRating = Math.round(rating);
  if (!Number.isFinite(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
    return { error: 'Rating must be between 1 and 5.' };
  }

  const trimmedComment = comment?.trim() || null;
  if (trimmedComment && trimmedComment.length > 2000) {
    return { error: 'Comment is too long (max 2000 characters).' };
  }

  const created = await prisma.productReview.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      rating: normalizedRating,
      comment: trimmedComment,
    },
  });

  await recordAuditLog({
    adminId: user.id,
    adminEmail: user.email,
    action: 'feedback.review_submitted',
    targetType: 'ProductReview',
    targetId: created.id,
    after: { rating: normalizedRating, comment: trimmedComment },
  });

  await sendEmail({
    to: FEEDBACK_NOTIFICATION_EMAIL,
    subject: `New ${normalizedRating}-star review from ${user.email ?? user.name ?? 'a user'}`,
    html: renderBrandedEmail({
      previewText: `New ${normalizedRating}-star review`,
      heading: 'New product review',
      bodyHtml: `
        <p style="margin:0 0 4px;color:#696c74;font-size:13px;">From ${user.email ?? user.name ?? user.id}</p>
        ${starRatingHtml(normalizedRating)}
        ${trimmedComment ? `<div style="margin-top:14px;padding:16px 18px;border-radius:14px;background:#faf6f1;white-space:pre-wrap;">${escapeHtml(trimmedComment)}</div>` : ''}
      `,
      ctaLabel: 'View all reviews',
      ctaUrl: `${process.env.BETTER_AUTH_URL ?? ''}/admin/feedback`,
    }),
    text: `New ${normalizedRating}-star review from ${user.email ?? user.name ?? user.id}${trimmedComment ? `:\n\n${trimmedComment}` : '.'}`,
  }).catch((error) => console.error('Failed to send review notification email:', error));

  revalidatePath('/admin/feedback');
  return { success: true };
}

/**
 * Returns the signed-in user's own feedback messages (newest first), so the
 * feedback widget can show them any admin replies.
 */
export async function getMyFeedbackMessagesAction() {
  const user = await getCurrentUser();
  if (!user) return [];

  return prisma.feedbackMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      message: true,
      status: true,
      response: true,
      translatedResponse: true,
      language: true,
      respondedAt: true,
      createdAt: true,
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
