import { getAnthropicClient } from '@/lib/anthropic';
import { buildUntrustedCall, redactSensitive, registerAgentExecutor, runAgentAction, wrapUntrusted, type AgentScope } from '@/lib/agents';
import type { ReplyClass } from '@/lib/investor-hub/constants';
import { HUB_MODEL } from '@/lib/investor-hub/extract';
import { prisma } from '@/lib/prisma';

import { audit } from './notify';
import { confirmMeeting, createMeetingRequest, projectScope, platformScope, proposeSlots, sendProposals, getOrCreateType, type Scope } from './service';
import { isHttpsUrl, type MeetingCategory, type Participant, type SourceType } from './logic';

/** The Meeting Scheduler runs under the customer-engagement role; its actions are namespaced `meeting.*`. */
export const SCHEDULER_AGENT = 'CUSTOMER_ENGAGEMENT' as const;
export const SCHEDULER_LABEL = 'Meeting Scheduler';

const agentScope = (s: Scope): AgentScope => (s.scopeType === 'PROJECT' ? { type: 'PROJECT', projectId: s.scopeId } : { type: 'PLATFORM' });
const scopeFromAgent = (s: AgentScope): Scope => (s.type === 'PROJECT' ? projectScope(s.projectId) : platformScope);

export type AiMeetingPayload = {
  category: MeetingCategory;
  title: string;
  participants: Participant[];
  agenda: string;
  sourceType: SourceType;
  sourceId: string | null;
  hostUserId: string | null;
  idempotencyKey: string;
  /** Only proposed after policy allows; the participant must still choose a time. */
  sendProposal: boolean;
  /** Owner-approved, https-only deck link to include in the agenda. */
  approvedDeckUrl?: string | null;
  briefing?: string | null;
};

async function executeRequest(scope: AgentScope, payload: AiMeetingPayload) {
  const s = scopeFromAgent(scope);
  const agenda = [payload.agenda, payload.approvedDeckUrl && isHttpsUrl(payload.approvedDeckUrl) ? `Deck: ${payload.approvedDeckUrl}` : ''].filter(Boolean).join('\n');
  const { meeting, duplicate } = await createMeetingRequest({
    scope: s,
    category: payload.category,
    title: payload.title,
    participants: payload.participants,
    agenda,
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    hostUserId: payload.hostUserId,
    requestedByAgent: true,
    idempotencyKey: payload.idempotencyKey,
  });
  if (payload.briefing && !meeting.internalNotes) await prisma.meeting.updateMany({ where: { id: meeting.id, internalNotes: null }, data: { internalNotes: payload.briefing.slice(0, 20_000) } });
  let summary = duplicate ? `Meeting ${meeting.id} already requested.` : `Meeting ${meeting.id} requested.`;
  if (meeting.status === 'REQUESTED') {
    const p = await proposeSlots(meeting.id, 'agent');
    if (p.ok) {
      summary += ` ${p.proposals.length} times proposed.`;
      if (payload.sendProposal) {
        const sent = await sendProposals(meeting.id, 'agent');
        summary += sent.ok ? ' Times emailed to the participant.' : ` Times not emailed: ${sent.error}`;
      }
    } else summary += ` No times proposed: ${p.error}`;
  }
  return { summary, meetingId: meeting.id };
}

registerAgentExecutor('meeting.request', async (ctx) => {
  const r = await executeRequest(ctx.scope, ctx.payload as AiMeetingPayload);
  return { summary: r.summary };
});

/**
 * Agent-initiated meeting request. Policy decides: Assist drafts only, Approval queues for the owner, Autonomous
 * proceeds only when the owner allowed the `meeting_request` category. Inbound text is wrapped as untrusted data.
 */
export async function requestMeetingViaAgent(scope: Scope, payload: AiMeetingPayload, untrustedText: string, reason: string) {
  const wrapped = wrapUntrusted(untrustedText, { label: 'inbound', maxLength: 1500 });
  const agent = agentScope(scope);
  return runAgentAction({
    scope: agent,
    agent: SCHEDULER_AGENT,
    action: 'meeting.request',
    category: 'meeting_request',
    tool: 'meetings',
    input: `${SCHEDULER_LABEL}: ${reason}\n${redactSensitive(wrapped.content)}`.slice(0, 1500),
    payload,
    idempotencyKey: `meeting-request:${payload.idempotencyKey}`,
    execute: async () => {
      const r = await executeRequest(agent, payload);
      return { summary: r.summary };
    },
  });
}

// ---- Autonomous booking (explicitly authorised routine workflows only) ---------------------------------------------

registerAgentExecutor('meeting.book', async (ctx) => {
  const { meetingId } = ctx.payload as { meetingId: string };
  const accepted = await prisma.meetingSlotProposal.findFirst({ where: { meetingId, status: 'ACCEPTED' }, orderBy: { startsAt: 'asc' } });
  if (!accepted) throw new Error('The participant has not agreed to a time.');
  const r = await confirmMeeting(meetingId, accepted.startsAt, 'agent', { participantAgreed: true });
  if (!r.ok) throw new Error(r.error);
  return { summary: `Meeting ${meetingId} booked.` };
});

export type AutoBookDecision = { allowed: boolean; reason: string };

/** Pure gate: the type must be explicitly marked autonomous AND the participant must already have agreed to a time. */
export function autoBookGate(type: { autonomousBooking: boolean; requiresApproval: boolean }, participantAgreed: boolean): AutoBookDecision {
  if (!participantAgreed) return { allowed: false, reason: 'The participant has not agreed to a time.' };
  if (!type.autonomousBooking) return { allowed: false, reason: 'This meeting type is not authorised for autonomous booking.' };
  return { allowed: true, reason: 'Routine workflow authorised by the owner.' };
}

export async function maybeAutoBook(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting || meeting.status !== 'AWAITING_CONFIRMATION') return { booked: false, reason: 'Not awaiting confirmation.' };
  const scope: Scope = { scopeType: meeting.scopeType as Scope['scopeType'], scopeId: meeting.scopeId };
  const type = await getOrCreateType(scope, meeting.category as MeetingCategory, meeting.typeId);
  const accepted = await prisma.meetingSlotProposal.findFirst({ where: { meetingId, status: 'ACCEPTED' } });
  const gate = autoBookGate(type, Boolean(accepted));
  if (!gate.allowed) return { booked: false, reason: gate.reason };
  const run = await runAgentAction({
    scope: agentScope(scope),
    agent: SCHEDULER_AGENT,
    action: 'meeting.book',
    category: 'meeting_booking',
    tool: 'meetings',
    input: `${SCHEDULER_LABEL}: book "${meeting.title}" (participant agreed)`,
    payload: { meetingId },
    idempotencyKey: `meeting-book:${meetingId}:${accepted?.startsAt.toISOString()}`,
    execute: async () => {
      const r = await confirmMeeting(meetingId, (accepted as { startsAt: Date }).startsAt, 'agent', { participantAgreed: true });
      if (!r.ok) throw new Error(r.error);
      return { summary: `Meeting ${meetingId} booked.` };
    },
  });
  await audit(meetingId, 'agent', 'autobook.decision', { outcome: run.outcome, status: run.status });
  return { booked: run.status === 'DONE', reason: run.reason };
}

// ---- Investor reply hook -------------------------------------------------------------------------------------------------

const POSITIVE: ReplyClass[] = ['interested', 'meeting_requested', 'deck_requested'];

/**
 * A meeting is only proposed for a positive classification. This never records that the investor agreed to a time:
 * agreement happens only when they pick a proposed time through the signed link (or staff record it).
 */
export const investorWantsMeeting = (classification: ReplyClass) => POSITIVE.includes(classification);

/** Verified facts only: unverified fields are left out of the briefing. */
export function buildInvestorBriefing(investor: { name: string; firm: string | null; verified: boolean; focus: string | null; sectors: string[]; stages: string[]; ticketMin: number | null; ticketMax: number | null; lastVerifiedAt: Date | null; fieldMeta: unknown }) {
  const meta = (investor.fieldMeta ?? {}) as Record<string, { verified?: boolean }>;
  const ok = (f: string) => investor.verified || meta[f]?.verified === true;
  const lines = [`Investor: ${investor.name}${investor.firm ? ` (${investor.firm})` : ''}`];
  if (investor.focus && ok('focus')) lines.push(`Focus: ${investor.focus}`);
  if (investor.sectors.length && ok('sectors')) lines.push(`Sectors: ${investor.sectors.join(', ')}`);
  if (investor.stages.length && ok('stages')) lines.push(`Stages: ${investor.stages.join(', ')}`);
  if ((investor.ticketMin || investor.ticketMax) && ok('ticketMin')) lines.push(`Ticket: ${investor.ticketMin ?? '?'}-${investor.ticketMax ?? '?'}`);
  lines.push(investor.lastVerifiedAt ? `Verified ${investor.lastVerifiedAt.toISOString().slice(0, 10)}; unverified details omitted.` : 'Nothing here has been verified yet; unverified details omitted.');
  return lines.join('\n');
}

export async function onInvestorReply(input: { userId: string; projectId: string; investorId: string; classification: ReplyClass; text: string; approvedDeckUrl?: string | null }) {
  if (!investorWantsMeeting(input.classification)) return null;
  const investor = await prisma.hubInvestor.findFirst({ where: { id: input.investorId, userId: input.userId, projectId: input.projectId } });
  if (!investor || investor.optedOut || !investor.email) return null;
  const payload: AiMeetingPayload = {
    category: 'INVESTOR',
    title: `Meeting with ${investor.name}${investor.firm ? ` (${investor.firm})` : ''}`,
    participants: [{ name: investor.name, email: investor.email, role: 'REQUIRED' }],
    agenda: 'Introduction and discussion of the opportunity.',
    sourceType: 'INVESTOR',
    sourceId: investor.id,
    hostUserId: input.userId,
    idempotencyKey: `investor:${investor.id}`,
    sendProposal: true,
    approvedDeckUrl: input.approvedDeckUrl ?? null,
    briefing: buildInvestorBriefing(investor),
  };
  return requestMeetingViaAgent(projectScope(input.projectId), payload, input.text, `investor reply classified "${input.classification}"`);
}

// ---- Lead consultation / support escalation / in-app request -------------------------------------------------------------

const CONSULT = /\b(consultation|book a (call|demo|meeting)|schedule a (call|demo|meeting)|speak (to|with)|talk to|call me|demo)\b/i;
export const asksForMeeting = (text: string) => CONSULT.test(text);

export async function onLeadConsultation(projectId: string, leadId: string, text: string) {
  if (!asksForMeeting(text)) return null;
  const lead = await prisma.lead.findFirst({ where: { id: leadId, projectId } });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { createdById: true } });
  if (!lead || lead.optedOut || !lead.email || !lead.consent) return null;
  const payload: AiMeetingPayload = {
    category: 'CUSTOMER',
    title: `Consultation with ${lead.name}`,
    participants: [{ name: lead.name, email: lead.email, phone: lead.phone, role: 'REQUIRED' }],
    agenda: 'Consultation requested by the lead.',
    sourceType: 'LEAD',
    sourceId: lead.id,
    hostUserId: project?.createdById ?? null,
    idempotencyKey: `lead:${lead.id}`,
    sendProposal: true,
  };
  return requestMeetingViaAgent(projectScope(projectId), payload, text, 'lead asked for a consultation');
}

const HIGH = new Set(['legal', 'security', 'refund', 'payment', 'account_change', 'commitment', 'pricing_exception', 'complaint']);
export const supportPriority = (category: string) => (HIGH.has(category) ? 'HIGH' : category === 'review' ? 'NORMAL' : 'NORMAL');

export async function onSupportEscalation(input: { projectId: string; ticketId: string; category: string; contact: string | null; summary: string }) {
  if (!input.contact) return null;
  const isEmail = input.contact.includes('@');
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { createdById: true } });
  const priority = supportPriority(input.category);
  const payload: AiMeetingPayload = {
    category: 'USER',
    title: `Support call (${priority}): ${input.category}`.slice(0, 120),
    participants: [{ name: isEmail ? input.contact : 'Customer', email: isEmail ? input.contact : null, phone: isEmail ? null : input.contact, role: 'REQUIRED' }],
    agenda: `Priority: ${priority}. The assistant could not resolve this request (ticket ${input.ticketId}).`,
    sourceType: 'SUPPORT_TICKET',
    sourceId: input.ticketId,
    hostUserId: project?.createdById ?? null,
    idempotencyKey: `ticket:${input.ticketId}`,
    sendProposal: false,
  };
  return requestMeetingViaAgent(projectScope(input.projectId), payload, input.summary, `support escalation (${priority})`);
}

// ---- Post-meeting summary --------------------------------------------------------------------------------------------------

const SENSITIVE = /\b(price|pricing|discount|refund|equity|valuation|term sheet|contract|guarantee|invest(ment)? amount|commit|exclusiv)/i;
export const isSensitiveCommitment = (text: string) => SENSITIVE.test(text);

export type ActionItem = { text: string; sensitive: boolean; approved: boolean };

export function parseActionItems(raw: string): ActionItem[] {
  return raw
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((l) => l.length > 3)
    .slice(0, 12)
    .map((text) => ({ text: text.slice(0, 300), sensitive: isSensitiveCommitment(text), approved: false }));
}

registerAgentExecutor('meeting.commitment', async (ctx) => {
  const { meetingId, text } = ctx.payload as { meetingId: string; text: string };
  const m = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { nextSteps: true } });
  const items = ((m?.nextSteps as ActionItem[] | null) ?? []).map((i) => (i.text === text ? { ...i, approved: true } : i));
  await prisma.meeting.update({ where: { id: meetingId }, data: { nextSteps: items as unknown as object } });
  return { summary: 'Commitment approved.' };
});

/**
 * Summary and action items come only from the notes a host wrote, plus the transcript when recorded consent exists.
 * Sensitive commitments are queued for approval (binding_commitment) and never marked approved here.
 */
export async function summariseMeeting(meetingId: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!m) return { ok: false, error: 'Meeting not found.' };
  const sources: { label: string; content: string }[] = [];
  if (m.internalNotes?.trim()) sources.push({ label: 'host_notes', content: m.internalNotes });
  if (m.transcript?.trim()) {
    if (!m.transcriptConsent) return { ok: false, error: 'A transcript exists but participant consent was not recorded; it will not be used.' };
    sources.push({ label: 'transcript', content: m.transcript });
  }
  if (!sources.length) return { ok: false, error: 'There are no authorised notes to summarise.' };
  const call = buildUntrustedCall({
    system: 'You summarise business meetings for the host. Use only the supplied notes. Do not invent decisions, numbers or commitments.',
    task: 'Write a summary of at most 120 words, then a line "ACTIONS:" followed by one action item per line starting with "- ".',
    untrusted: sources.map((s) => ({ label: s.label, content: s.content, maxLength: 12_000 })),
  });
  let text: string;
  try {
    const res = await getAnthropicClient().messages.create({ model: HUB_MODEL, max_tokens: 700, system: call.system, messages: call.messages });
    const block = res.content.find((c) => c.type === 'text');
    text = block && block.type === 'text' ? block.text : '';
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The summary could not be generated.' };
  }
  const [summary, actions = ''] = text.split(/ACTIONS:/i);
  const items = parseActionItems(actions);
  await prisma.meeting.update({ where: { id: meetingId }, data: { summary: summary.trim().slice(0, 4000), nextSteps: items as unknown as object } });
  const scope: Scope = { scopeType: m.scopeType as Scope['scopeType'], scopeId: m.scopeId };
  for (const item of items.filter((i) => i.sensitive)) {
    await runAgentAction({
      scope: agentScope(scope),
      agent: SCHEDULER_AGENT,
      action: 'meeting.commitment',
      category: 'meeting_commitment',
      kinds: ['binding_commitment'],
      tool: 'meetings',
      input: `${SCHEDULER_LABEL}: sensitive follow-up needs approval: ${item.text}`.slice(0, 1500),
      payload: { meetingId, text: item.text },
      idempotencyKey: `meeting-commitment:${meetingId}:${item.text.slice(0, 60)}`,
    }).catch(() => undefined);
  }
  await audit(meetingId, actor, 'summary.generated', { flags: call.flags, items: items.length });
  return { ok: true };
}
