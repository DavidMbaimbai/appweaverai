import { parseCsv, toCsv } from '@/lib/investor-hub/csv';
import { prisma } from '@/lib/prisma';

import {
  CONSENT_TEXT,
  cleanUtm,
  dedupeByEmail,
  isEmail,
  isLeadStatus,
  leadFromSubmissionData,
  normalizeEmail,
  type LeadInput,
  type LeadStatus,
} from './logic';

export const MAX_CSV_ROWS = 1000;

export async function logActivity(leadId: string, type: string, detail = '') {
  await prisma.leadActivity.create({ data: { leadId, type, detail: detail.slice(0, 2000) } });
}

type UpsertOptions = { formSubmissionId?: string | null; consentText?: string | null };

/** Creates a lead or merges into the existing one with the same email (never overwrites what the lead already gave us). */
export async function upsertLead(projectId: string, input: LeadInput, options: UpsertOptions = {}) {
  const email = normalizeEmail(input.email);
  const existing = email ? await prisma.lead.findUnique({ where: { projectId_email: { projectId, email } } }) : null;
  const now = new Date();

  if (existing) {
    const consentUpgrade = input.consent && !existing.consent;
    await prisma.lead.update({
      where: { id: existing.id },
      data: {
        phone: existing.phone || input.phone || undefined,
        utm: existing.utm ?? input.utm ?? undefined,
        notes: input.notes && !existing.notes.includes(input.notes) ? `${existing.notes}${existing.notes ? '\n' : ''}${input.notes}`.slice(0, 5000) : undefined,
        ...(consentUpgrade ? { consent: true, consentAt: now, consentText: options.consentText ?? CONSENT_TEXT } : {}),
      },
    });
    await logActivity(existing.id, 'RESUBMITTED', `Submitted again via ${input.source}`);
    return { id: existing.id, created: false };
  }

  const lead = await prisma.lead.create({
    data: {
      projectId,
      name: input.name,
      email,
      phone: input.phone,
      source: input.source,
      utm: input.utm ?? undefined,
      notes: input.notes,
      consent: input.consent,
      consentText: input.consent ? (options.consentText ?? CONSENT_TEXT) : null,
      consentAt: input.consent ? now : null,
      formSubmissionId: options.formSubmissionId ?? null,
    },
    select: { id: true },
  });
  await logActivity(lead.id, 'CREATED', `Captured via ${input.source}`);
  return { id: lead.id, created: true };
}

/** Best-effort: the form endpoint must never fail because of CRM capture. */
export async function captureFromSubmission(projectId: string, submissionId: string, formName: string, data: unknown) {
  try {
    const input = leadFromSubmissionData(formName, data);
    if (input) await upsertLead(projectId, input, { formSubmissionId: submissionId });
  } catch (error) {
    console.error('[leads] capture from form failed:', error);
  }
}

/** Imports form submissions not yet in the CRM; idempotent through the unique formSubmissionId. */
export async function importFormSubmissions(projectId: string) {
  const submissions = await prisma.projectFormSubmission.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { id: true, formName: true, data: true },
  });
  if (!submissions.length) return { imported: 0, merged: 0, skipped: 0 };
  const done = new Set(
    (
      await prisma.lead.findMany({
        where: { projectId, formSubmissionId: { in: submissions.map((s) => s.id) } },
        select: { formSubmissionId: true },
      })
    ).map((l) => l.formSubmissionId),
  );
  const result = { imported: 0, merged: 0, skipped: 0 };
  for (const s of submissions) {
    if (done.has(s.id)) continue;
    const input = leadFromSubmissionData(s.formName, s.data);
    if (!input) {
      result.skipped++;
      continue;
    }
    try {
      const res = await upsertLead(projectId, input, { formSubmissionId: s.id });
      if (res.created) result.imported++;
      else result.merged++;
    } catch {
      result.skipped++;
    }
  }
  return result;
}

const CSV_COLUMNS: Record<string, 'name' | 'email' | 'phone' | 'source' | 'notes'> = {
  name: 'name',
  fullname: 'name',
  email: 'email',
  emailaddress: 'email',
  phone: 'phone',
  mobile: 'phone',
  source: 'source',
  notes: 'notes',
  message: 'notes',
};

export function parseLeadCsv(text: string): LeadInput[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const map = rows[0].map((h) => CSV_COLUMNS[h.trim().toLowerCase().replace(/[\s_-]/g, '')]);
  if (!map.includes('name') && !map.includes('email')) return [];
  const out: LeadInput[] = [];
  for (const row of rows.slice(1, MAX_CSV_ROWS + 1)) {
    const rec: Record<string, string> = {};
    map.forEach((key, i) => {
      if (key) rec[key] = (row[i] ?? '').trim().replace(/^'(?=[=+\-@])/, '');
    });
    const email = normalizeEmail(rec.email);
    if (email && !isEmail(email)) continue;
    if (!rec.name && !email) continue;
    out.push({
      name: (rec.name || email!.split('@')[0]).slice(0, 120),
      email,
      phone: rec.phone?.slice(0, 40) || null,
      source: rec.source?.slice(0, 80) || 'csv-import',
      utm: null,
      notes: (rec.notes ?? '').slice(0, 2000),
      consent: false,
    });
  }
  return out;
}

/** Imported contacts never carry consent; the owner must attest to it per lead. */
export async function importLeadsCsv(projectId: string, text: string) {
  const parsed = parseLeadCsv(text);
  const { unique, duplicates } = dedupeByEmail(parsed);
  let created = 0;
  let merged = 0;
  for (const row of unique) {
    const res = await upsertLead(projectId, row);
    if (res.created) created++;
    else merged++;
  }
  return { rows: parsed.length, created, merged: merged + duplicates };
}

export async function exportLeadsCsv(projectId: string) {
  const leads = await prisma.lead.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 5000 });
  return toCsv(
    ['name', 'email', 'phone', 'status', 'score', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'consent', 'opted_out', 'created_at', 'notes'],
    leads.map((l) => {
      const utm = cleanUtm(l.utm) ?? {};
      return [l.name, l.email, l.phone, l.status, l.score, l.source, utm.source, utm.medium, utm.campaign, l.consent, l.optedOut, l.createdAt.toISOString(), l.notes];
    }),
  );
}

export async function setLeadStatus(leadId: string, status: LeadStatus) {
  if (!isLeadStatus(status)) return false;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { status: true } });
  if (!lead || lead.status === status) return false;
  await prisma.lead.update({ where: { id: leadId }, data: { status } });
  await logActivity(leadId, 'STATUS', `${lead.status} → ${status}`);
  return true;
}

export async function addFollowUp(leadId: string, dueAt: Date, note: string) {
  const row = await prisma.leadFollowUp.create({ data: { leadId, dueAt, note: note.slice(0, 500) } });
  await logActivity(leadId, 'FOLLOW_UP', `Reminder set for ${dueAt.toISOString().slice(0, 10)}`);
  return row;
}

/** Slots in the future only; capped so one owner can't create unbounded rows. */
export async function addSlots(projectId: string, startsAt: Date[], durationMin: number) {
  const now = Date.now();
  const valid = [...new Set(startsAt.filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > now).map((d) => d.getTime()))].slice(0, 50);
  const existing = await prisma.leadAvailabilitySlot.count({ where: { projectId, startsAt: { gte: new Date() } } });
  if (existing + valid.length > 200) return { created: 0, error: 'Too many open slots.' };
  const res = await prisma.leadAvailabilitySlot.createMany({
    data: valid.map((t) => ({ projectId, startsAt: new Date(t), durationMin })),
  });
  return { created: res.count };
}

export async function listOpenSlots(projectId: string) {
  return prisma.leadAvailabilitySlot.findMany({
    where: { projectId, startsAt: { gt: new Date() }, booking: null },
    orderBy: { startsAt: 'asc' },
    take: 60,
    select: { id: true, startsAt: true, durationMin: true },
  });
}

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 = 409,
  ) {
    super(message);
  }
}

/** The unique slotId on LeadBooking makes double-booking impossible even under races. */
export async function bookSlot(
  projectId: string,
  slotId: string,
  who: { name: string; email: string; phone?: string | null; consent?: boolean },
) {
  const slot = await prisma.leadAvailabilitySlot.findFirst({
    where: { id: slotId, projectId, startsAt: { gt: new Date() } },
    select: { id: true, startsAt: true, durationMin: true },
  });
  if (!slot) throw new BookingError('That time is no longer available.', 404);

  const lead = await upsertLead(
    projectId,
    {
      name: who.name,
      email: who.email,
      phone: who.phone ?? null,
      source: 'demo-booking',
      utm: null,
      notes: '',
      consent: Boolean(who.consent),
    },
    { consentText: CONSENT_TEXT },
  );
  try {
    await prisma.leadBooking.create({ data: { slotId: slot.id, leadId: lead.id } });
  } catch {
    throw new BookingError('That time was just taken. Please pick another.');
  }
  const current = await prisma.lead.findUnique({ where: { id: lead.id }, select: { status: true } });
  if (current && current.status !== 'WON') {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'DEMO_BOOKED' } });
  }
  await logActivity(lead.id, 'DEMO_BOOKED', `Booked ${slot.startsAt.toISOString()} (${slot.durationMin} min)`);
  return { leadId: lead.id, slot };
}
