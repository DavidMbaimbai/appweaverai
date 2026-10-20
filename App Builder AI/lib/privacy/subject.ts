import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { contactVariants, hashMessagingSuppressions, hashOutreachSuppressions } from './anonymise';
import { hashContact, normalizeEmailAddress, normalizePhoneDigits } from './identifiers';
import { suppressEmailHashed } from './suppression';
import { stripSecrets, collectUserData } from './user-data';
import { eraseUserAccount, type ErasureDeps, defaultErasureDeps } from './user-erasure';

export type SubjectQuery = { email?: string | null; phone?: string | null };

export type SubjectMatches = {
  users: string[];
  leads: string[];
  hubInvestors: string[];
  investorLeads: string[];
  campaignTargets: string[];
  investorConsents: string[];
  voiceCalls: string[];
  conversations: string[];
  contactConsents: string[];
  messagingSuppressions: string[];
  consentProofs: string[];
  meetings: string[];
  projectReviews: string[];
  supportTickets: string[];
  formSubmissions: string[];
  feedback: string[];
  productReviews: string[];
  outreachSuppressions: string[];
};

export type SubjectIdentity = { email: string | null; phone: string | null };

export function normalizeSubject(query: SubjectQuery): SubjectIdentity {
  const email = query.email?.trim() ? normalizeEmailAddress(query.email) : null;
  const phone = query.phone ? normalizePhoneDigits(query.phone) : null;
  if (!email && !phone) throw new Error('An email address or a phone number is required.');
  return { email, phone };
}

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);
const insensitive = (email: string) => ({ equals: email, mode: 'insensitive' as const });

async function rawIds(query: Prisma.Sql): Promise<string[]> {
  return (await prisma.$queryRaw<Array<{ id: string }>>(query)).map((r) => r.id);
}

/** Row ids in `table` whose `column` holds this phone number, however it was formatted. */
function phoneIds(table: string, column: string, digits: string, idColumn = 'id') {
  return rawIds(Prisma.sql`SELECT ${Prisma.raw(`"${idColumn}"`)} AS id FROM ${Prisma.raw(`"${table}"`)} WHERE regexp_replace(${Prisma.raw(`"${column}"`)}::text, '\\D', '', 'g') = ${digits}`);
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

/** Finds every record about a person across the platform, by email and/or phone. */
export async function findSubject(query: SubjectQuery): Promise<SubjectMatches> {
  const { email, phone } = normalizeSubject(query);
  const none = Promise.resolve([] as string[]);
  const byEmail = <T extends { id: string }>(run: (e: string) => Promise<T[]>) => (email ? run(email).then(ids) : none);
  const byPhone = (table: string, column: string, idColumn?: string) => (phone ? phoneIds(table, column, phone, idColumn) : none);
  const variants = contactVariants({ email, phone });
  const contactOr = variants.map((v) => ({ channel: v.channel, contact: v.contact }));

  const [
    users, leadsE, leadsP, investorsE, investorsContactsP, investorsConsentsP, investorsCallsP, investorLeadsE, investorLeadsP,
    targets, consentsP, calls, conversations, contactConsents, suppressions, proofs, meetingsE, meetingsP, reviews, ticketsE, ticketsP,
    formsE, formsP, feedback, productReviews, outreach,
  ] = await Promise.all([
    byEmail((e) => prisma.user.findMany({ where: { email: insensitive(e) }, select: { id: true } })),
    byEmail((e) => prisma.lead.findMany({ where: { email: insensitive(e) }, select: { id: true } })),
    byPhone('leads', 'phone'),
    byEmail((e) => prisma.hubInvestor.findMany({ where: { OR: [{ emailKey: e }, { email: insensitive(e) }] }, select: { id: true } })),
    byPhone('hub_investor_contacts', 'phone', 'investor_id'),
    byPhone('investor_consents', 'phone', 'investor_id'),
    byPhone('investor_voice_calls', 'to_number', 'investor_id'),
    byEmail((e) => prisma.investorLead.findMany({ where: { email: insensitive(e) }, select: { id: true } })),
    byPhone('investor_leads', 'phone'),
    byEmail((e) => prisma.investorCampaignTarget.findMany({ where: { email: insensitive(e) }, select: { id: true } })),
    byPhone('investor_consents', 'phone'),
    byPhone('investor_voice_calls', 'to_number'),
    contactOr.length
      ? prisma.conversation.findMany({
          where: { OR: variants.map((v) => ({ channel: v.channel, contactRef: v.channel === 'EMAIL' ? insensitive(v.contact) : v.contact })) },
          select: { id: true },
        }).then(ids)
      : none,
    contactOr.length ? prisma.contactConsent.findMany({ where: { OR: contactOr }, select: { id: true } }).then(ids) : none,
    contactOr.length ? prisma.messagingSuppression.findMany({ where: { OR: contactOr }, select: { id: true } }).then(ids) : none,
    contactOr.length ? prisma.consentProof.findMany({ where: { OR: contactOr }, select: { id: true } }).then(ids) : none,
    email ? rawIds(Prisma.sql`SELECT id FROM "meetings" WHERE "participants"::text ILIKE ${'%' + escapeLike(email) + '%'}`) : none,
    phone ? rawIds(Prisma.sql`SELECT id FROM "meetings" WHERE regexp_replace("participants"::text, '\\D', '', 'g') LIKE ${'%' + phone + '%'}`) : none,
    byEmail((e) => prisma.projectReview.findMany({ where: { authorEmail: insensitive(e) }, select: { id: true } })),
    byEmail((e) => prisma.projectSupportTicket.findMany({ where: { contact: insensitive(e) }, select: { id: true } })),
    byPhone('project_support_tickets', 'contact'),
    email ? rawIds(Prisma.sql`SELECT id FROM "project_form_submissions" WHERE "data"::text ILIKE ${'%' + escapeLike(email) + '%'}`) : none,
    phone ? rawIds(Prisma.sql`SELECT id FROM "project_form_submissions" WHERE regexp_replace("data"::text, '\\D', '', 'g') LIKE ${'%' + phone + '%'}`) : none,
    byEmail((e) => prisma.feedbackMessage.findMany({ where: { userEmail: insensitive(e) }, select: { id: true } })),
    byEmail((e) => prisma.productReview.findMany({ where: { userEmail: insensitive(e) }, select: { id: true } })),
    email ? prisma.outreachSuppression.findMany({ where: { email }, select: { email: true } }).then((rows) => rows.map((r) => r.email)) : none,
  ]);

  return {
    users,
    leads: union(leadsE, leadsP),
    hubInvestors: union(investorsE, investorsContactsP, investorsConsentsP, investorsCallsP),
    investorLeads: union(investorLeadsE, investorLeadsP),
    campaignTargets: targets,
    investorConsents: consentsP,
    voiceCalls: calls,
    conversations,
    contactConsents,
    messagingSuppressions: suppressions,
    consentProofs: proofs,
    meetings: union(meetingsE, meetingsP),
    projectReviews: reviews,
    supportTickets: union(ticketsE, ticketsP),
    formSubmissions: union(formsE, formsP),
    feedback,
    productReviews,
    outreachSuppressions: outreach,
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function summariseMatches(matches: SubjectMatches) {
  return Object.fromEntries(Object.entries(matches).map(([key, list]) => [key, list.length])) as Record<keyof SubjectMatches, number>;
}

export const totalMatches = (matches: SubjectMatches) => Object.values(matches).reduce((sum, list) => sum + list.length, 0);

/** Everything held about the subject, as JSON-safe sections. Account holders get their complete account export. */
export async function exportSubject(matches: SubjectMatches, subject: SubjectIdentity) {
  const accountExports = [];
  for (const userId of matches.users) accountExports.push({ userId, ...(await collectUserData(userId)).sections });
  const meetingRows = matches.meetings.length ? await prisma.meeting.findMany({ where: { id: { in: matches.meetings } } }) : [];
  const [leads, hubInvestors, hubContacts, hubSms, hubCalls, meetingRequests, investorLeads, targets, investorConsents, voiceCalls, conversations, contactConsents, suppressions, proofs, reviews, tickets, forms, feedback, productReviews] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: matches.leads } }, include: { activities: true, followUps: true, drafts: true, bookings: true } }),
    prisma.hubInvestor.findMany({ where: { id: { in: matches.hubInvestors } }, include: { activities: true, outreach: true, replies: true } }),
    prisma.hubInvestorContact.findMany({ where: { investorId: { in: matches.hubInvestors } } }),
    prisma.hubInvestorSms.findMany({ where: { investorId: { in: matches.hubInvestors } } }),
    prisma.hubInvestorCall.findMany({ where: { investorId: { in: matches.hubInvestors } } }),
    prisma.investorMeetingRequest.findMany({ where: { investorId: { in: matches.hubInvestors } } }),
    prisma.investorLead.findMany({ where: { id: { in: matches.investorLeads } } }),
    prisma.investorCampaignTarget.findMany({ where: { id: { in: matches.campaignTargets } }, include: { sends: true } }),
    prisma.investorConsent.findMany({ where: { OR: [{ id: { in: matches.investorConsents } }, { investorId: { in: matches.hubInvestors } }] } }),
    prisma.investorVoiceCall.findMany({ where: { OR: [{ id: { in: matches.voiceCalls } }, { investorId: { in: matches.hubInvestors } }] } }),
    prisma.conversation.findMany({ where: { id: { in: matches.conversations } }, include: { messages: true } }),
    prisma.contactConsent.findMany({ where: { id: { in: matches.contactConsents } } }),
    prisma.messagingSuppression.findMany({ where: { id: { in: matches.messagingSuppressions } } }),
    prisma.consentProof.findMany({ where: { id: { in: matches.consentProofs } } }),
    prisma.projectReview.findMany({ where: { id: { in: matches.projectReviews } } }),
    prisma.projectSupportTicket.findMany({ where: { id: { in: matches.supportTickets } } }),
    prisma.projectFormSubmission.findMany({ where: { id: { in: matches.formSubmissions } } }),
    prisma.feedbackMessage.findMany({ where: { id: { in: matches.feedback } } }),
    prisma.productReview.findMany({ where: { id: { in: matches.productReviews } } }),
  ]);
  return stripSecrets({
    subject: { email: subject.email, phone: subject.phone },
    generatedAt: new Date().toISOString(),
    accounts: accountExports,
    leads, hubInvestors, hubInvestorContacts: hubContacts, hubInvestorSms: hubSms, hubInvestorCalls: hubCalls,
    investorMeetingRequests: meetingRequests, investorLeads, investorCampaignTargets: targets, investorConsents, investorVoiceCalls: voiceCalls,
    conversations, contactConsents, messagingSuppressions: suppressions, consentProofs: proofs,
    meetings: meetingRows,
    projectReviews: reviews, projectSupportTickets: tickets, projectFormSubmissions: forms, feedback, productReviews,
    outreachSuppressions: matches.outreachSuppressions.map((e) => ({ email: e })),
  });
}

const ERASED = '[erased]';

function redact(text: string | null, terms: string[]) {
  if (!text) return text;
  return terms.reduce((acc, term) => (term ? acc.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ERASED) : acc), text);
}

export type EraseOptions = {
  /** Also adds a hashed opt-out so the person is not contacted again (default for erasure requests). */
  suppressFuture?: boolean;
  deps?: ErasureDeps;
};

/** Erases or anonymises everything matched. Idempotent: a second run finds nothing left to do. */
export async function eraseSubject(matches: SubjectMatches, subject: SubjectIdentity, options: EraseOptions = {}) {
  const deps = options.deps ?? defaultErasureDeps;
  const counts: Record<string, number> = {};
  const bump = (key: string, n: number) => {
    counts[key] = (counts[key] ?? 0) + n;
  };

  for (const userId of matches.users) {
    const result = await eraseUserAccount(userId, deps, { source: 'dsar' });
    if (result.erased) bump('accounts', 1);
  }

  // Everything we will delete is read first so opt-outs can be preserved and text redacted.
  const [leads, investors, targets, leadRows, meetings] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: matches.leads } }, select: { email: true, name: true, optedOut: true } }),
    prisma.hubInvestor.findMany({ where: { id: { in: matches.hubInvestors } }, select: { email: true, emailKey: true, name: true, optedOut: true } }),
    prisma.investorCampaignTarget.findMany({ where: { id: { in: matches.campaignTargets } }, select: { email: true } }),
    prisma.investorLead.findMany({ where: { id: { in: matches.investorLeads } }, select: { email: true, name: true, status: true } }),
    matches.meetings.length ? prisma.meeting.findMany({ where: { id: { in: matches.meetings } } }) : Promise.resolve([]),
  ]);
  const names = [...leads.map((l) => l.name), ...investors.map((i) => i.name), ...leadRows.map((l) => l.name)];
  const emails = [subject.email ?? '', ...leads.map((l) => l.email ?? ''), ...investors.flatMap((i) => [i.email ?? '', i.emailKey ?? '']), ...targets.map((t) => t.email), ...leadRows.map((l) => l.email ?? ''), ...matches.outreachSuppressions].filter(Boolean);

  for (const lead of leads) if (lead.optedOut && lead.email) await suppressEmailHashed(lead.email, 'OPT_OUT');
  for (const investor of investors) if (investor.optedOut && investor.email) await suppressEmailHashed(investor.email, 'OPT_OUT');
  for (const lead of leadRows) if (lead.status === 'DO_NOT_CONTACT' && lead.email) await suppressEmailHashed(lead.email, 'OPT_OUT');
  if (options.suppressFuture && subject.email) await suppressEmailHashed(subject.email, 'ERASURE_REQUEST');
  bump('suppressionsHashed', await hashOutreachSuppressions(emails));
  bump('suppressionsHashed', await hashMessagingSuppressions({ id: { in: matches.messagingSuppressions } }));
  if (options.suppressFuture) {
    for (const v of contactVariants(subject)) {
      const key = { scopeType: 'PLATFORM' as const, scopeId: 'PLATFORM', channel: v.channel, contact: hashContact(v.channel, v.contact) };
      await prisma.messagingSuppression.upsert({
        where: { scopeType_scopeId_channel_contact: key },
        create: { ...key, reason: 'ERASURE_REQUEST', source: 'privacy' },
        update: {},
      });
    }
  }

  const del = async (key: string, run: Promise<{ count: number }>) => bump(key, (await run).count);
  await del('conversations', prisma.conversation.deleteMany({ where: { id: { in: matches.conversations } } }));
  await del('contactConsents', prisma.contactConsent.deleteMany({ where: { id: { in: matches.contactConsents } } }));
  const proofRows = await prisma.consentProof.findMany({ where: { id: { in: matches.consentProofs }, NOT: { proof: ERASED } } });
  for (const proof of proofRows) {
    await prisma.consentProof.update({ where: { id: proof.id }, data: { contact: hashContact(proof.channel, proof.contact), proof: ERASED } });
  }
  bump('consentProofsAnonymised', proofRows.length);

  await del('leads', prisma.lead.deleteMany({ where: { id: { in: matches.leads } } }));
  const investorIds = matches.hubInvestors;
  await del('hubInvestorSms', prisma.hubInvestorSms.deleteMany({ where: { investorId: { in: investorIds } } }));
  await del('hubInvestorCalls', prisma.hubInvestorCall.deleteMany({ where: { investorId: { in: investorIds } } }));
  await del('hubInvestorContacts', prisma.hubInvestorContact.deleteMany({ where: { investorId: { in: investorIds } } }));
  await del('investorMeetingRequests', prisma.investorMeetingRequest.deleteMany({ where: { investorId: { in: investorIds } } }));
  await del('investorVoiceCalls', prisma.investorVoiceCall.deleteMany({ where: { OR: [{ id: { in: matches.voiceCalls } }, { investorId: { in: investorIds } }] } }));
  const consentRows = await prisma.investorConsent.findMany({
    where: { OR: [{ id: { in: matches.investorConsents } }, { investorId: { in: investorIds } }], NOT: { evidence: ERASED } },
    select: { id: true, revokedAt: true },
  });
  for (const row of consentRows) {
    await prisma.investorConsent.update({ where: { id: row.id }, data: { phone: null, evidence: ERASED, revokedAt: row.revokedAt ?? new Date() } });
  }
  bump('investorConsentsAnonymised', consentRows.length);
  await del('hubInvestors', prisma.hubInvestor.deleteMany({ where: { id: { in: investorIds } } }));
  await del('investorLeads', prisma.investorLead.deleteMany({ where: { id: { in: matches.investorLeads } } }));
  await del('investorCampaignTargets', prisma.investorCampaignTarget.deleteMany({ where: { id: { in: matches.campaignTargets } } }));

  const terms = [subject.email ?? '', subject.phone ?? '', ...names, ...emails].filter(Boolean);
  for (const meeting of meetings) {
    const participants = (Array.isArray(meeting.participants) ? meeting.participants : []) as Array<Record<string, unknown>>;
    const kept = participants.map((p) => {
      const pe = typeof p.email === 'string' ? normalizeEmailAddress(p.email) : null;
      const pp = typeof p.phone === 'string' ? normalizePhoneDigits(p.phone) : null;
      const hit = (subject.email && pe === subject.email) || (subject.phone && pp === subject.phone);
      return hit ? { name: ERASED, email: null, phone: null, role: p.role ?? 'REQUIRED' } : p;
    });
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        participants: kept as Prisma.InputJsonValue,
        title: redact(meeting.title, terms) ?? meeting.title,
        agenda: redact(meeting.agenda, terms) ?? meeting.agenda,
        locationText: redact(meeting.locationText, terms),
        internalNotes: null,
        transcript: null,
        summary: null,
        outcome: null,
        nextSteps: Prisma.DbNull,
        notesPurgedAt: new Date(),
      },
    });
  }
  bump('meetingsAnonymised', meetings.length);

  const reviewRows = await prisma.projectReview.findMany({ where: { id: { in: matches.projectReviews }, NOT: { authorName: ERASED } }, select: { id: true } });
  for (const row of reviewRows) {
    await prisma.projectReview.update({
      where: { id: row.id },
      data: { authorName: ERASED, authorEmail: null, body: ERASED, aiDraft: null, reply: null, draftOriginal: null, evidence: Prisma.DbNull, corrections: Prisma.DbNull },
    });
  }
  bump('projectReviewsAnonymised', reviewRows.length);
  await del('projectSupportTickets', prisma.projectSupportTicket.deleteMany({ where: { id: { in: matches.supportTickets } } }));
  await del('projectFormSubmissions', prisma.projectFormSubmission.deleteMany({ where: { id: { in: matches.formSubmissions } } }));
  await del('feedback', prisma.feedbackMessage.deleteMany({ where: { id: { in: matches.feedback } } }));
  await del('productReviews', prisma.productReview.deleteMany({ where: { id: { in: matches.productReviews } } }));

  return counts;
}
