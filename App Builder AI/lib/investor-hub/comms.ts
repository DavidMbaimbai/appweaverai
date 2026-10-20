import { prisma } from '@/lib/prisma';
import { suppress } from '@/lib/outreach/process';

import type { PipelineStage } from './constants';
import {
  buildTwilioBody,
  callEffect,
  isValidE164,
  normalizePhone,
  smsBlockReason,
  twilioConfig,
  withOptOutFooter,
  type CallOutcome,
} from './sms';
import { applyStage, HubError, logActivity, requireInvestor, type Ctx } from './service';
import { isValidTimeZone } from '@/lib/ads/schedule';

const scope = (ctx: Ctx) => ({ userId: ctx.userId, projectId: ctx.projectId });

export function isSmsDryRun() {
  return process.env.SMS_DRY_RUN === 'true' || !twilioConfig().configured;
}

export async function getComms(ctx: Ctx, investorId: string) {
  await requireInvestor(ctx, investorId);
  const [contact, calls, sms] = await Promise.all([
    prisma.hubInvestorContact.findUnique({ where: { investorId } }),
    prisma.hubInvestorCall.findMany({ where: { investorId, ...scope(ctx) }, orderBy: { calledAt: 'desc' }, take: 50 }),
    prisma.hubInvestorSms.findMany({ where: { investorId, ...scope(ctx) }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  return { contact: contact && contact.userId === ctx.userId ? contact : null, calls, sms, dryRun: isSmsDryRun() };
}

export type ContactInput = {
  phone?: string | null;
  timezone?: string | null;
  smsConsent?: boolean;
  consentNote?: string | null;
};

/** Consent must be recorded explicitly with how it was obtained; a STOP can never be undone from here. */
export async function saveContact(ctx: Ctx, investorId: string, input: ContactInput) {
  await requireInvestor(ctx, investorId);
  const existing = await prisma.hubInvestorContact.findUnique({ where: { investorId } });

  const data: {
    phone?: string | null;
    timezone?: string | null;
    smsConsent?: boolean;
    smsConsentAt?: Date | null;
    smsConsentNote?: string | null;
  } = {};

  if (input.phone !== undefined) {
    if (input.phone && !normalizePhone(input.phone)) {
      throw new HubError('Use international format with the country code, e.g. +14155550123.');
    }
    data.phone = normalizePhone(input.phone);
    if (data.phone !== (existing?.phone ?? null)) {
      // A new number is a new consent question.
      data.smsConsent = false;
      data.smsConsentAt = null;
    }
  }
  if (input.timezone !== undefined) {
    if (input.timezone && !isValidTimeZone(input.timezone)) throw new HubError('Unknown time zone.');
    data.timezone = input.timezone || null;
  }
  if (input.smsConsent !== undefined) {
    if (input.smsConsent) {
      if (existing?.smsOptedOut) throw new HubError('This investor replied STOP; SMS consent cannot be re-enabled.', 409);
      const note = (input.consentNote ?? existing?.smsConsentNote ?? '').trim();
      if (!note) throw new HubError('Record how and when the investor agreed to receive texts.');
      data.smsConsent = true;
      data.smsConsentAt = existing?.smsConsent ? existing.smsConsentAt : new Date();
      data.smsConsentNote = note.slice(0, 500);
    } else {
      data.smsConsent = false;
      data.smsConsentAt = null;
    }
  }

  const contact = await prisma.hubInvestorContact.upsert({
    where: { investorId },
    create: { ...scope(ctx), investorId, ...data },
    update: data,
  });
  if (input.smsConsent !== undefined) {
    await logActivity(ctx, investorId, 'sms_consent', input.smsConsent ? 'SMS consent recorded.' : 'SMS consent withdrawn.');
  }
  return contact;
}

export type CallInput = {
  calledAt: Date;
  outcome: CallOutcome;
  notes?: string | null;
  nextStep?: string | null;
  nextFollowUpAt?: Date | null;
};

/** Manual call logging only: nothing in the app dials. */
export async function logCall(ctx: Ctx, investorId: string, input: CallInput) {
  const investor = await requireInvestor(ctx, investorId);
  if (input.calledAt.getTime() > Date.now() + 60_000) throw new HubError('The call date cannot be in the future.');

  const call = await prisma.hubInvestorCall.create({
    data: {
      ...scope(ctx),
      investorId,
      calledAt: input.calledAt,
      outcome: input.outcome,
      notes: input.notes?.trim().slice(0, 4000) || null,
      nextStep: input.nextStep?.trim().slice(0, 300) || null,
    },
  });
  await logActivity(
    ctx,
    investorId,
    'call',
    `Call logged: ${input.outcome.replace(/_/g, ' ').toLowerCase()}${input.nextStep ? `. Next: ${input.nextStep.trim()}` : ''}.`,
  );

  const effect = callEffect(input.outcome);
  if (effect.optOut) await optOutInvestor(ctx, investorId, 'Asked not to be contacted (call).');
  else if (effect.stopSequence) {
    await prisma.hubInvestor.updateMany({
      where: { id: investorId, ...scope(ctx) },
      data: { sequenceActive: false, nextFollowUpAt: null },
    });
  }
  if (effect.stage) {
    await applyStage(ctx, investorId, investor.pipelineStage as PipelineStage, effect.stage, `Call: ${input.outcome.replace(/_/g, ' ').toLowerCase()}.`);
  }
  if (input.nextFollowUpAt && !effect.stopSequence) {
    await prisma.hubInvestor.updateMany({
      where: { id: investorId, ...scope(ctx) },
      data: { nextFollowUpAt: input.nextFollowUpAt },
    });
  }
  return call;
}

/** Marks the investor opted out everywhere: CRM, SMS and the shared email suppression list. */
export async function optOutInvestor(ctx: Ctx, investorId: string, reason: string) {
  const investor = await requireInvestor(ctx, investorId);
  await prisma.hubInvestor.updateMany({
    where: { id: investorId, ...scope(ctx) },
    data: { optedOut: true, sequenceActive: false, nextFollowUpAt: null },
  });
  await prisma.hubInvestorOutreach.updateMany({
    where: { investorId, ...scope(ctx), status: { in: ['DRAFT', 'APPROVED'] } },
    data: { status: 'CANCELLED' },
  });
  await prisma.hubInvestorContact.updateMany({
    where: { investorId },
    data: { smsOptedOut: true, smsOptedOutAt: new Date(), smsConsent: false },
  });
  if (investor.email) await suppress(investor.email, reason);
}

/** Inbound STOP from Twilio: opts out every investor record that uses this number. */
export async function optOutByPhone(phone: string) {
  if (!isValidE164(phone)) return 0;
  const contacts = await prisma.hubInvestorContact.findMany({ where: { phone }, select: { investorId: true } });
  for (const { investorId } of contacts) {
    const investor = await prisma.hubInvestor.findUnique({ where: { id: investorId } });
    if (!investor) continue;
    await prisma.hubInvestor.update({
      where: { id: investorId },
      data: { optedOut: true, sequenceActive: false, nextFollowUpAt: null },
    });
    await prisma.hubInvestorOutreach.updateMany({
      where: { investorId, status: { in: ['DRAFT', 'APPROVED'] } },
      data: { status: 'CANCELLED' },
    });
    await prisma.hubInvestorContact.update({
      where: { investorId },
      data: { smsOptedOut: true, smsOptedOutAt: new Date(), smsConsent: false },
    });
    await prisma.hubInvestorActivity.create({
      data: {
        userId: investor.userId,
        projectId: investor.projectId,
        investorId,
        type: 'sms_opt_out',
        summary: 'Investor replied STOP by SMS. All contact stopped.',
      },
    });
    if (investor.email) await suppress(investor.email, 'SMS STOP');
  }
  return contacts.length;
}

async function twilioSend(to: string, body: string) {
  const cfg = twilioConfig();
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: buildTwilioBody(to, body, { from: cfg.from, service: cfg.service }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!response.ok || !data.sid) throw new Error(`Twilio ${response.status}: ${data.message ?? 'send failed'}`);
  return data.sid;
}

/** Sends one text after every gate passes; with Twilio unset it is only logged as DRY_RUN. */
export async function sendInvestorSms(ctx: Ctx, investorId: string, rawBody: string, now = new Date()) {
  const investor = await requireInvestor(ctx, investorId);
  const contact = await prisma.hubInvestorContact.findUnique({ where: { investorId } });
  const blocked = smsBlockReason({
    phone: contact?.phone ?? null,
    timezone: contact?.timezone ?? null,
    smsConsent: Boolean(contact?.smsConsent),
    smsConsentAt: contact?.smsConsentAt ?? null,
    smsOptedOut: Boolean(contact?.smsOptedOut),
    investorOptedOut: investor.optedOut,
    now,
  });
  if (blocked || !contact?.phone) throw new HubError(blocked ?? 'No phone number.', 409);

  const body = withOptOutFooter(rawBody).slice(0, 600);
  if (!rawBody.trim()) throw new HubError('Write a message first.');

  const dryRun = isSmsDryRun();
  let status = 'SENT';
  let providerId: string | null = null;
  let error: string | null = null;
  if (dryRun) {
    status = 'DRY_RUN';
    console.info(`[investor-hub] SMS DRY RUN to ${contact.phone}: ${body.slice(0, 120)}`);
  } else {
    try {
      providerId = await twilioSend(contact.phone, body);
    } catch (e) {
      status = 'FAILED';
      error = e instanceof Error ? e.message.slice(0, 300) : 'Send failed';
    }
  }
  const row = await prisma.hubInvestorSms.create({
    data: { ...scope(ctx), investorId, body, status, providerId, error },
  });
  await logActivity(ctx, investorId, 'sms', `SMS ${status.toLowerCase().replace('_', ' ')}.`);
  if (status === 'FAILED') throw new HubError(error ?? 'SMS failed.', 502);
  return { id: row.id, status, dryRun };
}
