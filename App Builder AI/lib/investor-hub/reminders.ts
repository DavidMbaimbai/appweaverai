import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

export type DueReminder = {
  userId: string;
  projectId: string;
  name: string;
  firm: string | null;
  stage: string;
  dueAt: Date;
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** One digest per owner, oldest reminders first. */
export function groupByOwner(rows: DueReminder[]) {
  const owners = new Map<string, DueReminder[]>();
  for (const row of [...rows].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())) {
    owners.set(row.userId, [...(owners.get(row.userId) ?? []), row]);
  }
  return owners;
}

export function renderDigest(items: DueReminder[], projectNames: Map<string, string>, baseUrl: string) {
  const lines = items.map((i) => {
    const who = i.firm ? `${i.name} (${i.firm})` : i.name;
    const project = projectNames.get(i.projectId) ?? 'your project';
    return { who, project, due: i.dueAt.toISOString().slice(0, 10), stage: i.stage.replace(/_/g, ' ').toLowerCase(), projectId: i.projectId };
  });
  const subject = `${items.length} investor follow-up${items.length === 1 ? '' : 's'} due`;
  const text = [
    `You have ${items.length} investor follow-up${items.length === 1 ? '' : 's'} due:`,
    '',
    ...lines.map((l) => `- ${l.who} · ${l.project} · due ${l.due} · ${l.stage}`),
    '',
    `Open the Investor Hub: ${baseUrl}/app/investors`,
    'Nothing is sent to investors automatically; these are reminders for you.',
  ].join('\n');
  const html = `<p>You have ${items.length} investor follow-up${items.length === 1 ? '' : 's'} due:</p><ul>${lines
    .map((l) => `<li>${escapeHtml(l.who)} &middot; ${escapeHtml(l.project)} &middot; due ${l.due} &middot; ${escapeHtml(l.stage)}</li>`)
    .join('')}</ul><p><a href="${baseUrl}/app/investors">Open the Investor Hub</a></p><p>Nothing is sent to investors automatically; these are reminders for you.</p>`;
  return { subject, text, html };
}

/** Emails each owner a digest of follow-ups whose reminder date has passed (opted-out and closed investors are skipped). */
export async function sendInvestorReminderDigests(now = new Date()) {
  const due = await prisma.hubInvestor.findMany({
    where: {
      nextFollowUpAt: { lte: now },
      optedOut: false,
      pipelineStage: { notIn: ['DECLINED', 'FUNDING_SECURED'] },
    },
    select: { userId: true, projectId: true, name: true, firm: true, pipelineStage: true, nextFollowUpAt: true },
    orderBy: { nextFollowUpAt: 'asc' },
    take: 2000,
  });
  const rows: DueReminder[] = due.map((d) => ({
    userId: d.userId,
    projectId: d.projectId,
    name: d.name,
    firm: d.firm,
    stage: d.pipelineStage,
    dueAt: d.nextFollowUpAt as Date,
  }));
  const owners = groupByOwner(rows);
  const summary = { owners: owners.size, reminders: rows.length, emailed: 0, skipped: 0 };
  if (!owners.size) return summary;

  const [users, projects] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...owners.keys()] } }, select: { id: true, email: true } }),
    prisma.project.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.projectId))] } }, select: { id: true, name: true } }),
  ]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const emails = new Map(users.map((u) => [u.id, u.email]));
  const base = appBaseUrl();

  for (const [userId, items] of owners) {
    const to = emails.get(userId);
    if (!to) {
      summary.skipped++;
      continue;
    }
    const mail = renderDigest(items, names, base);
    try {
      await sendEmail({ to, ...mail });
      summary.emailed++;
    } catch (error) {
      console.error('[investor-reminders] email failed:', error);
      summary.skipped++;
    }
  }
  return summary;
}
