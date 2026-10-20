'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { reviewLead } from '@/lib/outreach/process';
import { reviewInteraction } from '@/lib/social/replies/process';

type ActionResult = { success: true } | { error: string };

const MESSAGES: Record<string, string> = {
  'not-reviewable': 'This item was already handled or is no longer reviewable.',
  'empty-reply': 'There is no reply text to send.',
  'send-failed': 'Sending failed. It stays in the queue so you can retry.',
  'not-configured': 'Outreach is not configured (SMTP and OUTREACH_POSTAL_ADDRESS are required).',
  suppressed: 'This address opted out or is on the do-not-contact list.',
  'daily-limit': 'The daily send limit has been reached.',
  'no-email': 'The lead has no valid email, subject or body.',
};

async function authorize() {
  const auth = await requireAdmin('outreach:write');
  return auth.ok ? auth.admin : null;
}

export async function reviewInteractionAction(
  id: string,
  review: { action: 'approve'; reply?: string } | { action: 'reject' },
): Promise<ActionResult> {
  const admin = await authorize();
  if (!admin) return { error: 'Not authorized.' };

  const outcome = await reviewInteraction(id, review);
  if (!outcome.ok) return { error: MESSAGES[outcome.error] ?? 'Could not complete the action.' };

  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: `social_reply.${review.action}`,
    targetType: 'SocialInteraction',
    targetId: id,
    before: null,
    after: review.action === 'approve' ? { reply: review.reply ?? null } : null,
  });
  revalidatePath('/admin/outreach');
  return { success: true };
}

export async function reviewLeadAction(
  id: string,
  review:
    | { action: 'approve'; subject?: string; body?: string }
    | { action: 'reject' }
    | { action: 'do-not-contact' },
): Promise<ActionResult> {
  const admin = await authorize();
  if (!admin) return { error: 'Not authorized.' };

  const outcome = await reviewLead(id, review);
  if (!outcome.ok) return { error: MESSAGES[outcome.error] ?? 'Could not complete the action.' };

  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: `investor_outreach.${review.action}`,
    targetType: 'InvestorLead',
    targetId: id,
    before: null,
    after: null,
  });
  revalidatePath('/admin/outreach');
  return { success: true };
}
