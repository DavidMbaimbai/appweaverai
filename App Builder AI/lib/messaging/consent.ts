import { scopeId, type AgentScope } from '@/lib/agents/types';
import { prisma } from '@/lib/prisma';

import { normalizeContact, type ConsentProofRecord, type ConsentRecord } from './gates';
import type { MessageChannelName } from './types';
import { hashContact } from '@/lib/privacy/identifiers';

function key(scope: AgentScope, channel: MessageChannelName, contact: string) {
  return {
    scopeType_scopeId_channel_contact: {
      scopeType: scope.type,
      scopeId: scopeId(scope),
      channel,
      contact: normalizeContact(channel, contact),
    },
  };
}

/** Same row key with the contact replaced by its keyed hash: how opt-outs are kept after the contact's data is erased. */
function hashedKey(scope: AgentScope, channel: MessageChannelName, contact: string) {
  const plain = key(scope, channel, contact).scopeType_scopeId_channel_contact;
  return { scopeType_scopeId_channel_contact: { ...plain, contact: hashContact(channel, plain.contact) } };
}

export async function getConsent(scope: AgentScope, channel: MessageChannelName, contact: string): Promise<ConsentRecord> {
  const row = await prisma.contactConsent.findUnique({ where: key(scope, channel, contact) });
  return row ? { optIn: row.optIn, optOut: row.optOut } : null;
}

/** Records an opt-in or opt-out. Opting out clears the opt-in and adds the contact to the suppression list; opting in lifts it. */
export async function recordConsent(
  scope: AgentScope,
  channel: MessageChannelName,
  contact: string,
  change: { optIn?: boolean; optOut?: boolean; source: string; reason?: string },
) {
  const optOut = change.optOut === true;
  const optIn = change.optIn === true && !optOut;
  const data = { optIn, optOut, source: change.source.slice(0, 100) };
  await prisma.contactConsent.upsert({
    where: key(scope, channel, contact),
    create: { scopeType: scope.type, scopeId: scopeId(scope), channel, contact: normalizeContact(channel, contact), ...data },
    update: data,
  });
  if (optOut) {
    await suppress(scope, channel, contact, change.reason ?? 'STOP', change.source);
  } else if (change.optIn === true) {
    await prisma.messagingSuppression.deleteMany({ where: key(scope, channel, contact).scopeType_scopeId_channel_contact });
    await prisma.messagingSuppression.deleteMany({ where: hashedKey(scope, channel, contact).scopeType_scopeId_channel_contact });
  }
}

/** Adds a contact to the suppression list (idempotent). */
export async function suppress(scope: AgentScope, channel: MessageChannelName, contact: string, reason: string, source: string) {
  const where = key(scope, channel, contact);
  const values = { reason: reason.slice(0, 50), source: source.slice(0, 100) };
  await prisma.messagingSuppression.upsert({
    where,
    create: { ...where.scopeType_scopeId_channel_contact, ...values },
    update: values,
  });
}

export async function getSuppression(scope: AgentScope, channel: MessageChannelName, contact: string) {
  return (
    (await prisma.messagingSuppression.findUnique({ where: key(scope, channel, contact) })) ??
    (await prisma.messagingSuppression.findUnique({ where: hashedKey(scope, channel, contact) }))
  );
}

/** Stores a marketing/lead opt-in with its evidence (source, proof text, capture time). Refuses without proof. */
export async function recordOptInProof(
  scope: AgentScope,
  channel: MessageChannelName,
  contact: string,
  input: { source: string; proof: string; capturedAt: Date },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const source = input.source.trim();
  const proof = input.proof.trim();
  if (!source || !proof) return { ok: false, error: 'An opt-in needs a source and proof of what the contact agreed to.' };
  if (Number.isNaN(input.capturedAt.getTime()) || input.capturedAt.getTime() > Date.now() + 60_000) {
    return { ok: false, error: 'The opt-in timestamp is invalid.' };
  }
  const suppression = await getSuppression(scope, channel, contact);
  if (suppression && suppression.createdAt >= input.capturedAt) {
    return { ok: false, error: 'The contact opted out after this opt-in was captured.' };
  }
  await prisma.consentProof.create({
    data: {
      scopeType: scope.type,
      scopeId: scopeId(scope),
      channel,
      contact: normalizeContact(channel, contact),
      source: source.slice(0, 100),
      proof: proof.slice(0, 2000),
      capturedAt: input.capturedAt,
    },
  });
  await recordConsent(scope, channel, contact, { optIn: true, source });
  return { ok: true };
}

/** Latest opt-in proof for the contact, or null. */
export async function getOptInProof(scope: AgentScope, channel: MessageChannelName, contact: string): Promise<ConsentProofRecord> {
  const row = await prisma.consentProof.findFirst({
    where: { scopeType: scope.type, scopeId: scopeId(scope), channel, contact: normalizeContact(channel, contact) },
    orderBy: { capturedAt: 'desc' },
  });
  return row ? { source: row.source, proof: row.proof, capturedAt: row.capturedAt } : null;
}
