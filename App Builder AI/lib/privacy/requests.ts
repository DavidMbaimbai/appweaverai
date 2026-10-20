import { randomBytes } from 'crypto';

import { recordAuditLog } from '@/lib/admin/audit';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

import { digest, hashEmail, hashPhone, normalizeEmailAddress, normalizePhoneDigits } from './identifiers';
import { eraseSubject, exportSubject, findSubject, normalizeSubject, summariseMatches, totalMatches, type EraseOptions } from './subject';

export const REQUEST_TYPES = ['ACCESS', 'ERASURE', 'RECTIFICATION', 'OBJECTION', 'OTHER'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_OUTCOMES = ['FULFILLED', 'PARTIALLY_FULFILLED', 'NO_DATA_FOUND', 'REFUSED'] as const;
export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

export const SLA_DAYS = 30;
export const VERIFY_TTL_MS = 48 * 3_600_000;
const DAY = 86_400_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Actor = { id: string; email: string | null };

export type SlaState = 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'CLOSED' | 'NOT_STARTED';

/** SLA position of a request. The clock runs from verified receipt; due-soon means 5 days or fewer remain. */
export function slaState(request: { status: string; dueAt: Date | null }, now = new Date()): { state: SlaState; daysLeft: number | null } {
  if (request.status === 'COMPLETED' || request.status === 'REJECTED') return { state: 'CLOSED', daysLeft: null };
  if (!request.dueAt) return { state: 'NOT_STARTED', daysLeft: null };
  const daysLeft = Math.ceil((request.dueAt.getTime() - now.getTime()) / DAY);
  if (daysLeft < 0) return { state: 'OVERDUE', daysLeft };
  return { state: daysLeft <= 5 ? 'DUE_SOON' : 'ON_TRACK', daysLeft };
}

const tokenHash = (token: string) => digest(`privacy-verify:${token}`);
const appBase = () => (process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.BETTER_AUTH_URL?.trim() || 'https://appweaverai.com').replace(/\/$/, '');

export type IntakeInput = { type: string; name?: string; email: string; phone?: string; details?: string; ip?: string };
export type IntakeResult = { ok: true; token: string; id: string } | { ok: false; error: string };

/** Creates an unverified request and emails a verification link. The clock does not start until the email is verified. */
export async function submitRequest(input: IntakeInput, now = new Date()): Promise<IntakeResult> {
  const email = input.email?.trim() ?? '';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { ok: false, error: 'Enter a valid email address.' };
  if (!(REQUEST_TYPES as readonly string[]).includes(input.type)) return { ok: false, error: 'Choose a request type.' };
  const phone = input.phone?.trim() ? input.phone.trim().slice(0, 40) : null;
  if (phone && !normalizePhoneDigits(phone)) return { ok: false, error: 'Enter a valid phone number or leave it blank.' };

  const token = randomBytes(24).toString('hex');
  const row = await prisma.privacyRequest.create({
    data: {
      type: input.type,
      requesterName: input.name?.trim().slice(0, 200) || null,
      email: normalizeEmailAddress(email),
      emailHash: hashEmail(email),
      phone,
      phoneHash: phone ? hashPhone(phone) : null,
      details: input.details?.trim().slice(0, 4000) || null,
      verifyTokenHash: tokenHash(token),
      verifyExpiresAt: new Date(now.getTime() + VERIFY_TTL_MS),
      receivedAt: now,
      ipHash: input.ip ? digest(`ip:${input.ip}`) : null,
      events: { create: { action: 'SUBMITTED' } },
    },
  });

  const link = `${appBase()}/privacy/request?token=${token}`;
  await sendEmail({
    to: row.email!,
    subject: 'Confirm your privacy request',
    text: `We received a privacy request for this email address. Confirm it within 48 hours: ${link}\n\nIf you did not make this request, ignore this message and nothing will happen.`,
    html: `<p>We received a privacy request for this email address.</p><p><a href="${link}">Confirm your request</a> within 48 hours.</p><p>If you did not make this request, ignore this message and nothing will happen.</p>`,
  }).catch((error) => console.error('Privacy verification email failed:', error));

  return { ok: true, token, id: row.id };
}

export type VerifyResult = { ok: true; id: string; dueAt: Date; alreadyVerified: boolean } | { ok: false; error: string };

export async function verifyRequest(token: string, now = new Date()): Promise<VerifyResult> {
  if (!token || token.length > 200) return { ok: false, error: 'This link is not valid.' };
  const row = await prisma.privacyRequest.findUnique({ where: { verifyTokenHash: tokenHash(token) } });
  if (!row) return { ok: false, error: 'This link is not valid.' };
  if (row.verifiedAt && row.dueAt) return { ok: true, id: row.id, dueAt: row.dueAt, alreadyVerified: true };
  if (!row.verifyExpiresAt || row.verifyExpiresAt < now) return { ok: false, error: 'This link has expired. Please submit your request again.' };
  const dueAt = new Date(now.getTime() + SLA_DAYS * DAY);
  const claimed = await prisma.privacyRequest.updateMany({
    where: { id: row.id, status: 'PENDING_VERIFICATION' },
    data: { status: 'OPEN', verifiedAt: now, dueAt },
  });
  if (claimed.count === 1) await prisma.privacyRequestEvent.create({ data: { requestId: row.id, action: 'VERIFIED' } });
  const fresh = await prisma.privacyRequest.findUnique({ where: { id: row.id } });
  return { ok: true, id: row.id, dueAt: fresh?.dueAt ?? dueAt, alreadyVerified: claimed.count === 0 };
}

export async function listRequests(filter: { status?: string } = {}, now = new Date()) {
  const rows = await prisma.privacyRequest.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'desc' }],
    take: 200,
  });
  return rows.map((row) => ({ ...row, sla: slaState(row, now) }));
}

export async function getRequest(id: string, now = new Date()) {
  const row = await prisma.privacyRequest.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } } } });
  return row ? { ...row, sla: slaState(row, now) } : null;
}

async function logEvent(requestId: string, actor: Actor | null, action: string, note?: string, after?: unknown) {
  await prisma.privacyRequestEvent.create({ data: { requestId, actorId: actor?.id ?? null, action, note: note ?? null } });
  await recordAuditLog({ adminId: actor?.id ?? null, adminEmail: actor?.email ?? null, action: `privacy.request.${action.toLowerCase()}`, targetType: 'PrivacyRequest', targetId: requestId, after });
}

/** The identifier to search for: the request's own email/phone, or an admin override (e.g. a second address). */
async function subjectFor(requestId: string, override?: { email?: string | null; phone?: string | null }) {
  const request = await prisma.privacyRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error('Request not found.');
  if (request.status === 'PENDING_VERIFICATION') throw new Error('The requester has not verified their email yet.');
  const email = override?.email ?? request.email;
  const phone = override?.phone ?? request.phone;
  if (!email && !phone) throw new Error('This request has been closed and its contact details removed.');
  return { request, query: { email, phone } };
}

export async function searchForRequest(requestId: string, actor: Actor, override?: { email?: string | null; phone?: string | null }) {
  const { query } = await subjectFor(requestId, override);
  const matches = await findSubject(query);
  await prisma.privacyRequest.updateMany({ where: { id: requestId, status: 'OPEN' }, data: { status: 'IN_PROGRESS', handledById: actor.id } });
  await logEvent(requestId, actor, 'SEARCHED', undefined, { found: totalMatches(matches) });
  return { matches, summary: summariseMatches(matches), total: totalMatches(matches) };
}

export async function exportForRequest(requestId: string, actor: Actor, override?: { email?: string | null; phone?: string | null }) {
  const { query } = await subjectFor(requestId, override);
  const subject = normalizeSubject(query);
  const matches = await findSubject(subject);
  const data = await exportSubject(matches, subject);
  await logEvent(requestId, actor, 'EXPORTED', undefined, { found: totalMatches(matches) });
  return data;
}

export async function eraseForRequest(requestId: string, actor: Actor, options: EraseOptions & { email?: string | null; phone?: string | null } = {}) {
  const { query } = await subjectFor(requestId, options);
  const subject = normalizeSubject(query);
  const matches = await findSubject(subject);
  const result = await eraseSubject(matches, subject, options);
  await logEvent(requestId, actor, 'ERASED', undefined, { found: totalMatches(matches) });
  return { result, found: totalMatches(matches) };
}

/** Closes a request with an outcome. Erasure/objection requests are scrubbed of contact details, keeping only hashes. */
export async function completeRequest(requestId: string, actor: Actor, outcome: RequestOutcome, note: string, now = new Date()) {
  if (!(REQUEST_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false as const, error: 'Choose an outcome.' };
  const request = await prisma.privacyRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false as const, error: 'Request not found.' };
  if (request.status === 'PENDING_VERIFICATION') return { ok: false as const, error: 'The requester has not verified their email yet.' };
  if (request.status === 'COMPLETED' || request.status === 'REJECTED') return { ok: true as const, alreadyClosed: true };
  const scrub = request.type === 'ERASURE' && outcome !== 'REFUSED';
  await prisma.privacyRequest.update({
    where: { id: requestId },
    data: {
      status: outcome === 'REFUSED' ? 'REJECTED' : 'COMPLETED',
      outcome,
      outcomeNote: note.trim().slice(0, 4000) || null,
      completedAt: now,
      handledById: actor.id,
      ...(scrub ? { requesterName: null, email: null, phone: null, details: null } : {}),
    },
  });
  await logEvent(requestId, actor, 'COMPLETED', note.trim().slice(0, 500) || undefined, { outcome, withinSla: request.dueAt ? now <= request.dueAt : null });
  return { ok: true as const, alreadyClosed: false };
}

export async function requestsSummary(now = new Date()) {
  const open = await prisma.privacyRequest.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { status: true, dueAt: true } });
  const states = open.map((row) => slaState(row, now).state);
  return { open: open.length, overdue: states.filter((s) => s === 'OVERDUE').length, dueSoon: states.filter((s) => s === 'DUE_SOON').length };
}

/** Housekeeping: unverified requests are discarded after their link expires; closed requests keep only hashed identifiers. */
export async function expireUnverifiedRequests(now = new Date()) {
  const cutoff = new Date(now.getTime() - 7 * DAY);
  return (await prisma.privacyRequest.deleteMany({ where: { status: 'PENDING_VERIFICATION', verifyExpiresAt: { lt: cutoff } } })).count;
}
