import { prisma } from '@/lib/prisma';
import { recordConsent } from '@/lib/messaging/consent';
import type { MessageChannelName } from '@/lib/messaging/types';

import { normalizeEmailAddress } from './identifiers';
import type { SubjectMatches } from './subject';

export type ConsentEntry = {
  /** `${kind}:${id}`, the handle passed to withdrawConsent. */
  key: string;
  kind: 'CONTACT' | 'INVESTOR' | 'LEAD' | 'SUPPRESSION' | 'OUTREACH_SUPPRESSION';
  label: string;
  scope: string;
  granted: boolean;
  detail: string;
  at: string;
  canWithdraw: boolean;
};

/** Lists the consents and opt-outs held for a subject. Suppressions are shown but can only be lifted by the person opting back in. */
export async function listSubjectConsents(matches: SubjectMatches): Promise<ConsentEntry[]> {
  const [contacts, suppressions, investorConsents, leads] = await Promise.all([
    prisma.contactConsent.findMany({ where: { id: { in: matches.contactConsents } } }),
    prisma.messagingSuppression.findMany({ where: { id: { in: matches.messagingSuppressions } } }),
    prisma.investorConsent.findMany({ where: { OR: [{ id: { in: matches.investorConsents } }, { investorId: { in: matches.hubInvestors } }] } }),
    prisma.lead.findMany({ where: { id: { in: matches.leads } }, select: { id: true, consent: true, optedOut: true, consentText: true, consentAt: true, createdAt: true, projectId: true } }),
  ]);
  const entries: ConsentEntry[] = [];
  for (const c of contacts) {
    entries.push({
      key: `CONTACT:${c.id}`,
      kind: 'CONTACT',
      label: `${c.channel} marketing/messaging`,
      scope: c.scopeType === 'PLATFORM' ? 'Platform' : `Project ${c.scopeId}`,
      granted: c.optIn && !c.optOut,
      detail: `${c.optOut ? 'Opted out' : c.optIn ? 'Opted in' : 'No choice recorded'} via ${c.source}`,
      at: c.updatedAt.toISOString(),
      canWithdraw: c.optIn && !c.optOut,
    });
  }
  for (const s of suppressions) {
    entries.push({
      key: `SUPPRESSION:${s.id}`,
      kind: 'SUPPRESSION',
      label: `${s.channel} suppression`,
      scope: s.scopeType === 'PLATFORM' ? 'Platform' : `Project ${s.scopeId}`,
      granted: false,
      detail: `Suppressed (${s.reason}) via ${s.source}`,
      at: s.createdAt.toISOString(),
      canWithdraw: false,
    });
  }
  for (const c of investorConsents) {
    entries.push({
      key: `INVESTOR:${c.id}`,
      kind: 'INVESTOR',
      label: `Investor ${c.type}`,
      scope: `Project ${c.projectId}`,
      granted: !c.revokedAt,
      detail: c.revokedAt ? 'Withdrawn' : 'Given',
      at: (c.revokedAt ?? c.obtainedAt).toISOString(),
      canWithdraw: !c.revokedAt,
    });
  }
  for (const lead of leads) {
    entries.push({
      key: `LEAD:${lead.id}`,
      kind: 'LEAD',
      label: 'Lead marketing consent',
      scope: `Project ${lead.projectId}`,
      granted: lead.consent && !lead.optedOut,
      detail: lead.optedOut ? 'Opted out' : lead.consent ? (lead.consentText ?? 'Consent given') : 'No consent recorded',
      at: (lead.consentAt ?? lead.createdAt).toISOString(),
      canWithdraw: lead.consent && !lead.optedOut,
    });
  }
  for (const email of matches.outreachSuppressions) {
    entries.push({ key: `OUTREACH_SUPPRESSION:${email}`, kind: 'OUTREACH_SUPPRESSION', label: 'Outreach email suppression', scope: 'Platform', granted: false, detail: 'Suppressed from outreach email', at: '', canWithdraw: false });
  }
  return entries;
}

/** Withdraws one consent through the same code paths the product uses, so suppression lists stay consistent. Idempotent. */
export async function withdrawConsent(key: string): Promise<{ ok: boolean; message: string }> {
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);

  if (kind === 'CONTACT') {
    const row = await prisma.contactConsent.findUnique({ where: { id } });
    if (!row) return { ok: false, message: 'Consent not found.' };
    const scope = row.scopeType === 'PLATFORM' ? ({ type: 'PLATFORM' } as const) : ({ type: 'PROJECT', projectId: row.scopeId } as const);
    await recordConsent(scope, row.channel as MessageChannelName, row.contact, { optOut: true, source: 'privacy-withdrawal', reason: 'WITHDRAWN' });
    return { ok: true, message: 'Withdrawn and added to the suppression list.' };
  }
  if (kind === 'INVESTOR') {
    await prisma.investorConsent.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true, message: 'Withdrawn.' };
  }
  if (kind === 'LEAD') {
    const lead = await prisma.lead.findUnique({ where: { id }, select: { email: true } });
    if (!lead) return { ok: false, message: 'Lead not found.' };
    await prisma.lead.update({ where: { id }, data: { consent: false, optedOut: true } });
    if (lead.email) {
      const email = normalizeEmailAddress(lead.email);
      await prisma.outreachSuppression.upsert({ where: { email }, create: { email, reason: 'WITHDRAWN' }, update: {} });
    }
    return { ok: true, message: 'Withdrawn and added to the suppression list.' };
  }
  return { ok: false, message: 'This entry cannot be withdrawn.' };
}
