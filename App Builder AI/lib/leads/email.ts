import { sendEmail } from '@/lib/email';
import { unsubscribeUrl } from '@/lib/outreach/compliance';
import { prisma } from '@/lib/prisma';
import { findOutreachSuppression } from '@/lib/privacy/suppression';
import { projectAccessWhere } from '@/lib/projects/access';

import { logActivity } from './service';
import { normalizeEmail, sendBlockReason } from './logic';

export const DAILY_SEND_LIMIT = Number(process.env.LEADS_DAILY_SEND_LIMIT ?? 20);

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function leadFooter(email: string, businessName: string) {
  const link = unsubscribeUrl(email);
  return {
    link,
    text: `\n\n--\nSent on behalf of ${businessName} via AppWeaver AI because you asked to be contacted. Don't want these emails? Unsubscribe: ${link}`,
    html: `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px"><div style="font-family:sans-serif;font-size:12px;color:#666;">Sent on behalf of ${escapeHtml(businessName)} via AppWeaver AI because you asked to be contacted. <a href="${link}">Unsubscribe</a></div>`,
  };
}

/** Sends an owner-approved draft. Every guard (consent, opt-out, suppression, daily cap) is re-checked at send time. */
export async function sendLeadDraft(userId: string, draftId: string, edits?: { subject: string; body: string }) {
  const draft = await prisma.leadEmailDraft.findFirst({
    where: { id: draftId, lead: { project: projectAccessWhere(userId) } },
    include: { lead: { include: { project: { select: { id: true, name: true, notificationEmail: true, createdBy: { select: { email: true } } } } } } },
  });
  if (!draft) return { ok: false as const, error: 'Draft not found.' };
  const lead = draft.lead;
  const key = normalizeEmail(lead.email);
  const suppressed = key ? Boolean(await findOutreachSuppression(key)) : false;
  const sentToday = await prisma.leadEmailDraft.count({
    where: { status: 'SENT', lead: { projectId: lead.projectId }, sentAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
  const blocked = sendBlockReason({
    email: key,
    consent: lead.consent,
    optedOut: lead.optedOut,
    suppressed,
    sentToday,
    dailyLimit: DAILY_SEND_LIMIT,
    draftStatus: draft.status,
  });
  if (blocked || !key) return { ok: false as const, error: blocked ?? 'No email address.' };

  const subject = (edits?.subject ?? draft.subject).trim().slice(0, 150);
  const body = (edits?.body ?? draft.body).trim().slice(0, 3000);
  if (!subject || !body) return { ok: false as const, error: 'Subject and body are required.' };

  // Claim first so a double click can't send twice.
  const claimed = await prisma.leadEmailDraft.updateMany({
    where: { id: draft.id, status: 'DRAFT' },
    data: { status: 'SENT', subject, body, approvedById: userId, sentAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false as const, error: 'This draft was already handled.' };

  try {
    const footer = leadFooter(key, lead.project.name);
    const replyTo = lead.project.notificationEmail || lead.project.createdBy.email;
    await sendEmail({
      to: key,
      subject,
      text: `${body}${footer.text}`,
      html: `<div style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(body)}</div>${footer.html}`,
      headers: { 'List-Unsubscribe': `<${footer.link}>`, ...(replyTo ? { 'Reply-To': replyTo } : {}) },
    });
  } catch (error) {
    console.error('[leads] send failed:', error);
    await prisma.leadEmailDraft.update({ where: { id: draft.id }, data: { status: 'DRAFT', sentAt: null } });
    return { ok: false as const, error: 'Email could not be sent. Please try again.' };
  }
  await logActivity(lead.id, 'EMAIL_SENT', `Sent: ${subject}`);
  if (lead.status === 'NEW') await prisma.lead.update({ where: { id: lead.id }, data: { status: 'CONTACTED' } });
  return { ok: true as const };
}

/** Transactional confirmation the visitor asked for by booking; no marketing content. */
export async function sendBookingConfirmation(input: {
  to: string;
  name: string;
  businessName: string;
  startsAt: Date;
  durationMin: number;
  ownerEmail: string | null;
  pendingConfirmation?: boolean;
}) {
  const when = input.startsAt.toUTCString();
  const lines = input.pendingConfirmation
    ? [`Hi ${input.name},`, '', `We received your demo request with ${input.businessName} for ${when} (${input.durationMin} minutes).`, 'This time is not confirmed yet: we will confirm it by email shortly.']
    : [`Hi ${input.name},`, '', `Your demo with ${input.businessName} is booked for ${when} (${input.durationMin} minutes).`, 'Reply to this email if you need to change the time.'];
  try {
    await sendEmail({
      to: input.to,
      subject: input.pendingConfirmation ? `Your demo request with ${input.businessName}` : `Your demo with ${input.businessName} is confirmed`,
      text: lines.join('\n'),
      html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''),
      headers: input.ownerEmail ? { 'Reply-To': input.ownerEmail } : undefined,
    });
    if (input.ownerEmail) {
      await sendEmail({
        to: input.ownerEmail,
        subject: `New demo booking: ${input.name}`,
        text: `${input.name} (${input.to}) booked ${when}.`,
        html: `<p>${escapeHtml(input.name)} (${escapeHtml(input.to)}) booked ${when}.</p>`,
      });
    }
  } catch (error) {
    console.error('[leads] booking confirmation failed:', error);
  }
}
