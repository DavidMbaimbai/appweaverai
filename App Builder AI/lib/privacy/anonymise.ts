import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { HASH_PREFIX, hashContact, hashEmail, normalizeEmailAddress, normalizePhoneDigits } from './identifiers';

export type SubjectIdentity = { email?: string | null; phone?: string | null };

/** Messaging contact spellings a person's email/phone can be stored under (mirrors messaging normalizeContact). */
export function contactVariants(subject: SubjectIdentity) {
  const variants: Array<{ channel: 'EMAIL' | 'SMS' | 'WHATSAPP'; contact: string }> = [];
  if (subject.email?.trim()) variants.push({ channel: 'EMAIL', contact: normalizeEmailAddress(subject.email) });
  const digits = subject.phone ? normalizePhoneDigits(subject.phone) : null;
  if (digits) {
    variants.push({ channel: 'SMS', contact: `+${digits}` }, { channel: 'SMS', contact: digits }, { channel: 'WHATSAPP', contact: digits });
  }
  return variants;
}

/** Replaces plain-text outreach opt-outs with their hashed form so the opt-out survives but the address does not. Idempotent. */
export async function hashOutreachSuppressions(emails: string[]) {
  let converted = 0;
  for (const raw of new Set(emails.filter(Boolean).map(normalizeEmailAddress))) {
    if (raw.startsWith(HASH_PREFIX)) continue;
    const plain = await prisma.outreachSuppression.findUnique({ where: { email: raw } });
    if (!plain) continue;
    const hashed = hashEmail(raw);
    await prisma.outreachSuppression.upsert({ where: { email: hashed }, create: { email: hashed, reason: plain.reason }, update: {} });
    await prisma.outreachSuppression.deleteMany({ where: { email: raw } });
    converted += 1;
  }
  return converted;
}

/** Same for messaging suppressions (any scope matching `where`). */
export async function hashMessagingSuppressions(where: Prisma.MessagingSuppressionWhereInput) {
  const rows = await prisma.messagingSuppression.findMany({ where: { AND: [where, { NOT: { contact: { startsWith: HASH_PREFIX } } }] } });
  for (const row of rows) {
    const hashed = hashContact(row.channel, row.contact);
    const key = { scopeType: row.scopeType, scopeId: row.scopeId, channel: row.channel, contact: hashed };
    await prisma.messagingSuppression.upsert({
      where: { scopeType_scopeId_channel_contact: key },
      create: { ...key, reason: row.reason, source: row.source },
      update: {},
    });
    await prisma.messagingSuppression.deleteMany({ where: { id: row.id } });
  }
  return rows.length;
}
