'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCachedSession } from '../auth/cached';
import { draftFollowUp, qualifyLead } from '../leads/ai';
import { sendLeadDraft } from '../leads/email';
import { BOOKING_DURATIONS, isLeadStatus } from '../leads/logic';
import { addFollowUp, addSlots, exportLeadsCsv, importFormSubmissions, importLeadsCsv, logActivity, setLeadStatus } from '../leads/service';
import { suppress } from '../outreach/process';
import { prisma } from '../prisma';
import { withMarketingCredits } from '../marketing-credits/run';
import { projectAccessWhere } from '../projects/access';
import { rateLimit } from '../rate-limit';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function requireUser() {
  const session = await getCachedSession();
  return session?.user?.id ?? null;
}

async function ownedProject(projectId: string, userId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, select: { id: true, name: true, description: true } });
}

/** Loads a lead only if the caller can access its project (multi-tenant guard). */
async function ownedLead(leadId: string, userId: string) {
  return prisma.lead.findFirst({ where: { id: leadId, project: projectAccessWhere(userId) } });
}

const refresh = () => revalidatePath('/app/projects');
const UNAUTHORIZED = { ok: false, error: 'Unauthorized' } as const;

export async function importSubmissionsAction(projectId: string): Promise<Result<{ message: string }>> {
  const userId = await requireUser();
  if (!userId || !(await ownedProject(projectId, userId))) return UNAUTHORIZED;
  const r = await importFormSubmissions(projectId);
  refresh();
  return { ok: true, message: `Imported ${r.imported} new, merged ${r.merged} duplicate, skipped ${r.skipped} without contact details.` };
}

export async function importCsvAction(projectId: string, text: string): Promise<Result<{ message: string }>> {
  const userId = await requireUser();
  if (!userId || !(await ownedProject(projectId, userId))) return UNAUTHORIZED;
  if (typeof text !== 'string' || text.length > 1_000_000) return { ok: false, error: 'CSV is too large.' };
  const r = await importLeadsCsv(projectId, text);
  if (!r.rows) return { ok: false, error: 'No valid rows. Use a header row with name and/or email columns.' };
  refresh();
  return { ok: true, message: `Read ${r.rows} rows: ${r.created} new, ${r.merged} merged into existing leads (deduped by email). Imported contacts have no email consent until you confirm it.` };
}

export async function exportCsvAction(projectId: string): Promise<Result<{ csv: string }>> {
  const userId = await requireUser();
  if (!userId || !(await ownedProject(projectId, userId))) return UNAUTHORIZED;
  return { ok: true, csv: await exportLeadsCsv(projectId) };
}

const updateSchema = z.object({
  status: z.string().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().max(5000).optional(),
  /** Owner attests consent was obtained outside the widget. */
  attestConsent: z.boolean().optional(),
});

export async function updateLeadAction(leadId: string, input: z.input<typeof updateSchema>): Promise<Result> {
  const userId = await requireUser();
  if (!userId) return UNAUTHORIZED;
  const lead = await ownedLead(leadId, userId);
  if (!lead) return UNAUTHORIZED;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const d = parsed.data;
  if (d.status !== undefined) {
    if (!isLeadStatus(d.status)) return { ok: false, error: 'Invalid status.' };
    await setLeadStatus(lead.id, d.status);
  }
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      name: d.name,
      phone: d.phone,
      notes: d.notes,
      ...(d.attestConsent && !lead.consent && !lead.optedOut
        ? { consent: true, consentAt: new Date(), consentText: 'Owner-attested: consent obtained outside the form.' }
        : {}),
    },
  });
  if (d.attestConsent && !lead.consent) await logActivity(lead.id, 'CONSENT', 'Owner attested email consent');
  refresh();
  return { ok: true };
}

export async function optOutLeadAction(leadId: string): Promise<Result> {
  const userId = await requireUser();
  const lead = userId ? await ownedLead(leadId, userId) : null;
  if (!lead) return UNAUTHORIZED;
  await prisma.lead.update({ where: { id: lead.id }, data: { optedOut: true } });
  if (lead.email) await suppress(lead.email, 'Lead CRM: owner marked do-not-contact');
  await logActivity(lead.id, 'OPT_OUT', 'Marked do-not-contact');
  refresh();
  return { ok: true };
}

export async function deleteLeadAction(leadId: string): Promise<Result> {
  const userId = await requireUser();
  const lead = userId ? await ownedLead(leadId, userId) : null;
  if (!lead) return UNAUTHORIZED;
  await prisma.lead.delete({ where: { id: lead.id } });
  refresh();
  return { ok: true };
}

export async function qualifyLeadAction(leadId: string): Promise<Result<{ usedAi: boolean }>> {
  const userId = await requireUser();
  const lead = userId ? await ownedLead(leadId, userId) : null;
  if (!userId || !lead) return UNAUTHORIZED;
  const limit = await rateLimit(`lead-ai:${userId}`, 60, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: `Hourly AI limit reached. Try again in ${limit.retryAfter}s.` };
  const q = await qualifyLead(lead);
  await prisma.lead.update({
    where: { id: lead.id },
    data: { score: q.score, scoreReasons: q.reasons, scoredAt: new Date(), suggestedAction: q.nextAction || null },
  });
  await logActivity(lead.id, 'QUALIFIED', `Score ${q.score}${q.usedAi ? '' : ' (basic completeness score; AI unavailable)'}`);
  refresh();
  return { ok: true, usedAi: q.usedAi };
}

export async function draftEmailAction(leadId: string): Promise<Result> {
  const userId = await requireUser();
  const lead = userId ? await ownedLead(leadId, userId) : null;
  if (!userId || !lead) return UNAUTHORIZED;
  if (!lead.email) return { ok: false, error: 'This lead has no email address.' };
  const limit = await rateLimit(`lead-ai:${userId}`, 60, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: `Hourly AI limit reached. Try again in ${limit.retryAfter}s.` };
  const project = await ownedProject(lead.projectId, userId);
  if (!project) return UNAUTHORIZED;
  const paid = await withMarketingCredits(
    {
      userId,
      projectId: lead.projectId,
      operation: 'lead_followup',
      refType: 'Lead',
      refId: lead.id,
      isFailure: (d: Awaited<ReturnType<typeof draftFollowUp>>) => !d,
    },
    () => draftFollowUp(lead, project),
  );
  if (!paid.ok) return { ok: false, error: paid.error };
  const draft = paid.value;
  if (!draft) return { ok: false, error: 'Could not produce a safe draft. Try again or write one yourself.' };
  await prisma.leadEmailDraft.create({ data: { leadId: lead.id, subject: draft.subject, body: draft.body } });
  await logActivity(lead.id, 'DRAFTED', 'AI drafted a follow-up email (awaiting approval)');
  refresh();
  return { ok: true };
}

export async function sendDraftAction(draftId: string, subject: string, body: string): Promise<Result> {
  const userId = await requireUser();
  if (!userId) return UNAUTHORIZED;
  const limit = await rateLimit(`lead-send:${userId}`, 30, 60 * 60_000);
  if (!limit.ok) return { ok: false, error: `Hourly send limit reached. Try again in ${limit.retryAfter}s.` };
  const res = await sendLeadDraft(userId, draftId, { subject: String(subject ?? ''), body: String(body ?? '') });
  if (res.ok) refresh();
  return res;
}

export async function cancelDraftAction(draftId: string): Promise<Result> {
  const userId = await requireUser();
  if (!userId) return UNAUTHORIZED;
  const res = await prisma.leadEmailDraft.updateMany({
    where: { id: draftId, status: 'DRAFT', lead: { project: projectAccessWhere(userId) } },
    data: { status: 'CANCELLED' },
  });
  refresh();
  return res.count ? { ok: true } : { ok: false, error: 'Draft not found.' };
}

export async function addFollowUpAction(leadId: string, dueAtIso: string, note: string): Promise<Result> {
  const userId = await requireUser();
  const lead = userId ? await ownedLead(leadId, userId) : null;
  if (!lead) return UNAUTHORIZED;
  const dueAt = new Date(dueAtIso);
  if (Number.isNaN(dueAt.getTime())) return { ok: false, error: 'Invalid date.' };
  await addFollowUp(lead.id, dueAt, String(note ?? ''));
  refresh();
  return { ok: true };
}

export async function completeFollowUpAction(followUpId: string): Promise<Result> {
  const userId = await requireUser();
  if (!userId) return UNAUTHORIZED;
  const res = await prisma.leadFollowUp.updateMany({
    where: { id: followUpId, doneAt: null, lead: { project: projectAccessWhere(userId) } },
    data: { doneAt: new Date() },
  });
  refresh();
  return res.count ? { ok: true } : { ok: false, error: 'Reminder not found.' };
}

export async function addSlotsAction(projectId: string, startsAtIso: string[], durationMin: number): Promise<Result<{ created: number }>> {
  const userId = await requireUser();
  if (!userId || !(await ownedProject(projectId, userId))) return UNAUTHORIZED;
  if (!(BOOKING_DURATIONS as readonly number[]).includes(durationMin)) return { ok: false, error: 'Invalid duration.' };
  const res = await addSlots(projectId, (Array.isArray(startsAtIso) ? startsAtIso : []).map((s) => new Date(s)), durationMin);
  if (res.error) return { ok: false, error: res.error };
  refresh();
  return { ok: true, created: res.created };
}

export async function deleteSlotAction(slotId: string): Promise<Result> {
  const userId = await requireUser();
  if (!userId) return UNAUTHORIZED;
  const res = await prisma.leadAvailabilitySlot.deleteMany({
    where: { id: slotId, booking: null, project: projectAccessWhere(userId) },
  });
  refresh();
  return res.count ? { ok: true } : { ok: false, error: 'Slot not found or already booked.' };
}
