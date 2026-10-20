import type { AgentScope } from '@/lib/agents/types';
import { scopeId } from '@/lib/agents/types';
import { prisma } from '@/lib/prisma';

import { recordOptInProof } from './consent';
import { normalizeContact } from './gates';
import { sendOutbound, type SendOutboundResult } from './send';

/**
 * Sends a lead follow-up over SMS or WhatsApp. The lead's recorded consent (checkbox text, source, timestamp) is
 * turned into an opt-in proof first; without it, or if the lead opted out, nothing is sent. All other gates
 * (suppression, UNAVAILABLE channel, 24h window/templates, credits) are enforced inside sendOutbound.
 */
export async function sendLeadMessage(input: {
  projectId: string;
  leadId: string;
  channel: 'SMS' | 'WHATSAPP';
  body: string;
  template?: Parameters<typeof sendOutbound>[0]['template'];
}): Promise<SendOutboundResult> {
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, projectId: input.projectId } });
  if (!lead?.phone) return { ok: false, error: 'This lead has no phone number.', blocked: true };
  if (lead.optedOut) return { ok: false, error: 'This lead opted out of messages.', blocked: true };
  if (!lead.consent || !lead.consentAt || !lead.consentText?.trim()) {
    return { ok: false, error: 'No recorded consent (text and timestamp) for this lead. Nothing was sent.', blocked: true };
  }

  const scope: AgentScope = { type: 'PROJECT', projectId: input.projectId };
  const proof = await recordOptInProof(scope, input.channel, lead.phone, {
    source: `lead:${lead.source ?? 'form'}`,
    proof: lead.consentText,
    capturedAt: lead.consentAt,
  });
  if (!proof.ok) return { ok: false, error: proof.error, blocked: true };

  const contactRef = normalizeContact(input.channel, lead.phone);
  const base = { scopeType: 'PROJECT' as const, scopeId: scopeId(scope), channel: input.channel, externalThreadId: contactRef };
  const conversation =
    (await prisma.conversation.findFirst({ where: base })) ??
    (await prisma.conversation.create({ data: { ...base, contactRef, contactName: lead.name ?? undefined, leadId: lead.id } }));

  return sendOutbound({ conversationId: conversation.id, scope, body: input.body, template: input.template, purpose: 'lead' });
}
