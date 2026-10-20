import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { finishScheduledSlot, holdScheduledSlot } from '@/lib/marketing-credits/run';

export type DueLeadReminder = {
  userId: string;
  projectName: string;
  workspaceSlug: string;
  projectSlug: string;
  leadName: string;
  note: string;
  dueAt: Date;
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** One digest per owner, oldest reminders first. */
export function groupByOwner(rows: DueLeadReminder[]) {
  const owners = new Map<string, DueLeadReminder[]>();
  for (const row of [...rows].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())) {
    owners.set(row.userId, [...(owners.get(row.userId) ?? []), row]);
  }
  return owners;
}

export function renderLeadDigest(items: DueLeadReminder[], baseUrl: string) {
  const plural = items.length === 1 ? '' : 's';
  const link = (i: DueLeadReminder) => `${baseUrl}/app/projects/${i.workspaceSlug}/${i.projectSlug}/leads`;
  const subject = `${items.length} lead follow-up${plural} due`;
  const text = [
    `You have ${items.length} lead follow-up${plural} due:`,
    '',
    ...items.map((i) => `- ${i.leadName} · ${i.projectName} · due ${i.dueAt.toISOString().slice(0, 10)}${i.note ? ` · ${i.note}` : ''}\n  ${link(i)}`),
    '',
    'Nothing is sent to leads automatically; these are reminders for you.',
  ].join('\n');
  const html = `<p>You have ${items.length} lead follow-up${plural} due:</p><ul>${items
    .map((i) => `<li><a href="${link(i)}">${escapeHtml(i.leadName)}</a> &middot; ${escapeHtml(i.projectName)} &middot; due ${i.dueAt.toISOString().slice(0, 10)}${i.note ? ` &middot; ${escapeHtml(i.note)}` : ''}</li>`)
    .join('')}</ul><p>Nothing is sent to leads automatically; these are reminders for you.</p>`;
  return { subject, text, html };
}

/** Emails each project owner a digest of open reminders that are due (closed WON/LOST leads are skipped). */
export async function sendLeadReminderDigests(now = new Date()) {
  const due = await prisma.leadFollowUp.findMany({
    where: { doneAt: null, dueAt: { lte: now }, lead: { status: { notIn: ['WON', 'LOST'] }, project: { deletedAt: null } } },
    orderBy: { dueAt: 'asc' },
    take: 2000,
    select: {
      dueAt: true,
      note: true,
      lead: { select: { name: true, project: { select: { name: true, slug: true, createdById: true, workspace: { select: { slug: true } } } } } },
    },
  });
  const rows: DueLeadReminder[] = due.map((d) => ({
    userId: d.lead.project.createdById,
    projectName: d.lead.project.name,
    workspaceSlug: d.lead.project.workspace.slug,
    projectSlug: d.lead.project.slug,
    leadName: d.lead.name,
    note: d.note,
    dueAt: d.dueAt,
  }));
  const owners = groupByOwner(rows);
  const summary = { owners: owners.size, reminders: rows.length, emailed: 0, skipped: 0 };
  if (!owners.size) return summary;

  const users = await prisma.user.findMany({ where: { id: { in: [...owners.keys()] } }, select: { id: true, email: true } });
  const emails = new Map(users.map((u) => [u.id, u.email]));
  const base = appBaseUrl();
  for (const [userId, items] of owners) {
    const to = emails.get(userId);
    if (!to) {
      summary.skipped++;
      continue;
    }
    const day = new Date().toISOString().slice(0, 10);
    const slot = await holdScheduledSlot({ userId, operation: 'lead_reminder', slot: day, jobId: `lead-digest:${userId}` });
    if (!slot.ok) {
      summary.skipped++;
      continue;
    }
    try {
      await sendEmail({ to, ...renderLeadDigest(items, base) });
      summary.emailed++;
      await finishScheduledSlot(slot.key, 'lead_reminder', true).catch(() => undefined);
    } catch (error) {
      console.error('[lead-reminders] email failed:', error);
      summary.skipped++;
      await finishScheduledSlot(slot.key, 'lead_reminder', false).catch(() => undefined);
    }
  }
  return summary;
}
