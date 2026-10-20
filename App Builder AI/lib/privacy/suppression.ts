import { prisma } from '@/lib/prisma';

import { hashEmail, normalizeEmailAddress } from './identifiers';

/**
 * Outreach suppression lookup that also honours opt-outs retained as hashes after the person's data was erased.
 * Every send path must use this instead of reading `outreachSuppression` by plain address.
 */
export async function findOutreachSuppression(email: string) {
  const key = normalizeEmailAddress(email);
  return (
    (await prisma.outreachSuppression.findUnique({ where: { email: key } })) ??
    (await prisma.outreachSuppression.findUnique({ where: { email: hashEmail(key) } }))
  );
}

export async function isOutreachSuppressed(email: string) {
  return Boolean(await findOutreachSuppression(email));
}

/** Adds an opt-out for the address without storing it in the clear. Idempotent. */
export async function suppressEmailHashed(email: string, reason: string) {
  const hashed = hashEmail(email);
  await prisma.outreachSuppression.upsert({ where: { email: hashed }, create: { email: hashed, reason }, update: {} });
}
