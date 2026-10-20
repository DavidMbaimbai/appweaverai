import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireProjectAccess } from '@/lib/hosting/api-auth';
import { researchInvestor } from '@/lib/investor-hub/brief';
import {
  INSTRUMENTS,
  INVESTOR_TYPES,
  OUTREACH_KINDS,
  PIPELINE_STAGES,
} from '@/lib/investor-hub/constants';
import { parseInvestorCsv } from '@/lib/investor-hub/csv';
import { getComms, logCall, optOutInvestor, saveContact, sendInvestorSms } from '@/lib/investor-hub/comms';
import { CALL_OUTCOMES } from '@/lib/investor-hub/sms';
import { discoverForProject } from '@/lib/investor-hub/discover';
import {
  approveOutreach,
  cancelOutreach,
  editOutreach,
  generateOutreach,
  markSent,
  stopSequence,
} from '@/lib/investor-hub/outreach';
import { recordReply } from '@/lib/investor-hub/replies';
import {
  approveCampaign,
  createCampaign,
  generateCampaignTemplate,
  listCampaigns,
  pauseCampaign,
  previewCampaign,
  resumeCampaign,
  stopCampaign,
  updateCampaign,
} from '@/lib/investor-hub/campaigns';
import { getVoice, recordConsent, revokeConsent, startAiCall } from '@/lib/investor-hub/voice';
import {
  addInvestor,
  addNote,
  deleteInvestor,
  exportAnalyticsCsv,
  exportInvestorsCsv,
  getAnalytics,
  getInvestorDetail,
  getProfile,
  HubError,
  importInvestors,
  listInvestors,
  rescoreAll,
  saveProfile,
  updateInvestor,
  type Ctx,
} from '@/lib/investor-hub/service';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';

export const maxDuration = 120;

const text = (max: number) => z.string().trim().max(max);
const stage = z.enum(PIPELINE_STAGES);
const money = z.number().int().min(0).max(100_000_000_000);

const profileSchema = z.object({
  companyName: text(200).optional(),
  website: text(300).optional(),
  description: text(3000).optional(),
  sector: text(120).optional(),
  stage: text(60).optional(),
  amountSought: money.nullable().optional(),
  currency: text(8).optional(),
  geography: text(200).optional(),
  traction: text(3000).optional(),
  useOfFunds: text(3000).optional(),
});

const investorSchema = z.object({
  name: text(200).min(1),
  firm: text(200).nullable().optional(),
  type: z.enum(INVESTOR_TYPES).optional(),
  website: text(300).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  linkedinUrl: text(300).nullable().optional(),
  focus: text(600).nullable().optional(),
  sectors: z.array(text(80)).max(10).optional(),
  stages: z.array(text(40)).max(6).optional(),
  geographies: z.array(text(80)).max(8).optional(),
  instruments: z.array(z.enum(INSTRUMENTS)).max(3).optional(),
  ticketMin: money.nullable().optional(),
  ticketMax: money.nullable().optional(),
  portfolio: z.array(text(100)).max(15).optional(),
  tags: z.array(text(40)).max(10).optional(),
});

const variantSchema = z.object({ subject: text(150).min(1), body: text(3000).min(1) });
const campaignSchema = z.object({
  name: text(120).min(1),
  templateSubject: text(150).min(1),
  templateBody: text(3000).min(1),
  variants: z.array(variantSchema).max(2).optional(),
  followUpBody: text(2000).optional(),
  settings: z
    .object({
      dailyLimit: z.number().int().min(1).max(50).optional(),
      sendWindowStart: z.number().int().min(0).max(23).optional(),
      sendWindowEnd: z.number().int().min(1).max(24).optional(),
      timezone: text(60).optional(),
      maxFollowUps: z.number().int().min(0).max(2).optional(),
      followUpDays: z.array(z.number().int().min(2).max(30)).max(2).optional(),
    })
    .optional(),
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveProfile'), profile: profileSchema }),
  z.object({
    action: z.literal('discover'),
    criteria: z.object({
      sector: text(120).optional(),
      geography: text(120).optional(),
      stage: text(60).optional(),
      ticketMin: money.optional(),
      ticketMax: money.optional(),
      instrument: z.enum(INSTRUMENTS).optional(),
    }),
  }),
  z.object({ action: z.literal('addInvestor'), investor: investorSchema }),
  z.object({ action: z.literal('importCsv'), csv: z.string().max(500_000) }),
  z.object({
    action: z.literal('updateInvestor'),
    id: z.string().min(1),
    stage: stage.optional(),
    tags: z.array(text(40)).max(20).optional(),
    nextFollowUpAt: z.string().datetime().nullable().optional(),
    verified: z.boolean().optional(),
    name: text(200).min(1).optional(),
    firm: text(200).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    confirmFunding: z.boolean().optional(),
    fundingAmount: money.nullable().optional(),
  }),
  z.object({ action: z.literal('addNote'), id: z.string().min(1), note: text(2000).min(1) }),
  z.object({ action: z.literal('deleteInvestor'), id: z.string().min(1) }),
  z.object({ action: z.literal('research'), id: z.string().min(1) }),
  z.object({ action: z.literal('rescore') }),
  z.object({
    action: z.literal('generate'),
    id: z.string().min(1),
    kind: z.enum(OUTREACH_KINDS),
    variants: z.number().int().min(1).max(3).optional(),
  }),
  z.object({ action: z.literal('editOutreach'), outreachId: z.string().min(1), subject: text(150).nullable().optional(), body: text(3000).min(1).optional() }),
  z.object({ action: z.literal('approve'), outreachId: z.string().min(1) }),
  z.object({ action: z.literal('cancelOutreach'), outreachId: z.string().min(1) }),
  z.object({ action: z.literal('markSent'), outreachId: z.string().min(1) }),
  z.object({ action: z.literal('stopSequence'), id: z.string().min(1) }),
  z.object({ action: z.literal('recordReply'), id: z.string().min(1), text: text(10_000).min(1) }),
  z.object({
    action: z.literal('saveContact'),
    id: z.string().min(1),
    phone: text(30).nullable().optional(),
    timezone: text(60).nullable().optional(),
    smsConsent: z.boolean().optional(),
    consentNote: text(500).nullable().optional(),
  }),
  z.object({
    action: z.literal('logCall'),
    id: z.string().min(1),
    calledAt: z.string().datetime(),
    outcome: z.enum(CALL_OUTCOMES),
    notes: text(4000).nullable().optional(),
    nextStep: text(300).nullable().optional(),
    nextFollowUpAt: z.string().datetime().nullable().optional(),
  }),
  z.object({ action: z.literal('sendSms'), id: z.string().min(1), body: text(500).min(1) }),
  z.object({ action: z.literal('optOut'), id: z.string().min(1) }),
  z.object({ action: z.literal('createCampaign'), investorIds: z.array(z.string().min(1)).min(1).max(500), campaign: campaignSchema }),
  z.object({ action: z.literal('updateCampaign'), campaignId: z.string().min(1), investorIds: z.array(z.string().min(1)).max(500).optional(), campaign: campaignSchema }),
  z.object({ action: z.literal('generateCampaignTemplate') }),
  z.object({ action: z.literal('approveCampaign'), campaignId: z.string().min(1), acknowledged: z.boolean() }),
  z.object({ action: z.literal('pauseCampaign'), campaignId: z.string().min(1) }),
  z.object({ action: z.literal('resumeCampaign'), campaignId: z.string().min(1) }),
  z.object({ action: z.literal('stopCampaign'), campaignId: z.string().min(1) }),
  z.object({
    action: z.literal('recordConsent'),
    id: z.string().min(1),
    type: z.enum(['AI_CALL', 'CALL_RECORDING']),
    evidence: text(1000).min(1),
    obtainedAt: z.string().datetime(),
  }),
  z.object({ action: z.literal('revokeConsent'), id: z.string().min(1), type: z.enum(['AI_CALL', 'CALL_RECORDING']) }),
  z.object({ action: z.literal('startAiCall'), id: z.string().min(1), confirmed: z.boolean(), transferNumber: text(30).nullable().optional() }),
]);

const HEAVY = new Set(['discover', 'research', 'generate', 'recordReply', 'sendSms', 'generateCampaignTemplate', 'startAiCall']);

async function guard(projectId: string, heavy: boolean): Promise<{ ctx: Ctx } | { error: Response }> {
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access;
  const key = `investor-hub:${heavy ? 'heavy' : 'std'}:${access.userId}`;
  const limit = heavy ? await rateLimit(key, 15, 60 * 60_000) : await rateLimit(key, 240, 60_000);
  if (!limit.ok) {
    return {
      error: NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      ),
    };
  }
  return { ctx: { userId: access.userId, projectId } };
}

function fail(error: unknown) {
  if (error instanceof HubError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[investor-hub]', error);
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}

const csvResponse = (body: string, name: string) =>
  new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await guard(projectId, false);
  if ('error' in auth) return auth.error;
  const { ctx } = auth;
  const url = new URL(request.url);
  const view = url.searchParams.get('view') ?? 'investors';

  try {
    switch (view) {
      case 'profile':
        return NextResponse.json({ profile: await getProfile(ctx) });
      case 'investors': {
        const stageParam = url.searchParams.get('stage');
        const typeParam = url.searchParams.get('type');
        const minScore = Number(url.searchParams.get('minScore'));
        return NextResponse.json({
          investors: await listInvestors(ctx, {
            q: url.searchParams.get('q')?.slice(0, 100) || undefined,
            stage: stage.safeParse(stageParam).data,
            type: z.enum(INVESTOR_TYPES).safeParse(typeParam).data,
            tag: url.searchParams.get('tag')?.slice(0, 40) || undefined,
            minScore: Number.isFinite(minScore) && url.searchParams.has('minScore') ? minScore : undefined,
            dueOnly: url.searchParams.get('due') === '1',
          }),
        });
      }
      case 'investor':
        return NextResponse.json(await getInvestorDetail(ctx, url.searchParams.get('id') ?? ''));
      case 'comms':
        return NextResponse.json(await getComms(ctx, url.searchParams.get('id') ?? ''));
      case 'outreach':
        return NextResponse.json({
          outreach: await prisma.hubInvestorOutreach.findMany({
            where: { userId: ctx.userId, projectId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: { investor: { select: { name: true, firm: true, email: true, optedOut: true } } },
          }),
        });
      case 'replies':
        return NextResponse.json({
          replies: await prisma.hubInvestorReply.findMany({
            where: { userId: ctx.userId, projectId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: { investor: { select: { name: true, firm: true } } },
          }),
        });
      case 'analytics':
        return NextResponse.json({ analytics: await getAnalytics(ctx) });
      case 'campaigns':
        return NextResponse.json(await listCampaigns(ctx));
      case 'campaign':
        return NextResponse.json(await previewCampaign(ctx, url.searchParams.get('id') ?? ''));
      case 'voice':
        return NextResponse.json(await getVoice(ctx, url.searchParams.get('id') ?? ''));
      case 'export':
        return url.searchParams.get('kind') === 'analytics'
          ? csvResponse(await exportAnalyticsCsv(ctx), 'investor-analytics.csv')
          : csvResponse(await exportInvestorsCsv(ctx), 'investors.csv');
      default:
        return NextResponse.json({ error: 'Unknown view.' }, { status: 400 });
    }
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const input = parsed.data;

  const auth = await guard(projectId, HEAVY.has(input.action));
  if ('error' in auth) return auth.error;
  const { ctx } = auth;

  try {
    switch (input.action) {
      case 'saveProfile':
        return NextResponse.json({ profile: await saveProfile(ctx, input.profile) });
      case 'discover':
        return NextResponse.json({ summary: await discoverForProject(ctx, input.criteria) });
      case 'addInvestor': {
        const result = await addInvestor(ctx, input.investor);
        return NextResponse.json(result, { status: result.created ? 201 : 409 });
      }
      case 'importCsv': {
        const rows = parseInvestorCsv(input.csv);
        if (!rows.length) throw new HubError('No rows found. The CSV needs a header row with a "name" column.');
        return NextResponse.json(await importInvestors(ctx, rows));
      }
      case 'updateInvestor': {
        const { action: _action, id, nextFollowUpAt, ...patch } = input;
        void _action;
        const investor = await updateInvestor(ctx, id, {
          ...patch,
          ...(nextFollowUpAt !== undefined ? { nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null } : {}),
        });
        return NextResponse.json({ investor });
      }
      case 'addNote':
        await addNote(ctx, input.id, input.note);
        return NextResponse.json({ ok: true });
      case 'deleteInvestor':
        await deleteInvestor(ctx, input.id);
        return NextResponse.json({ ok: true });
      case 'research':
        return NextResponse.json(await researchInvestor(ctx, input.id));
      case 'rescore':
        await rescoreAll(ctx);
        return NextResponse.json({ ok: true });
      case 'generate':
        return NextResponse.json({
          outreach: await generateOutreach(ctx, input.id, input.kind, input.variants ?? 2),
          delivery: 'manual',
        });
      case 'editOutreach':
        await editOutreach(ctx, input.outreachId, { subject: input.subject, body: input.body });
        return NextResponse.json({ ok: true });
      case 'approve':
        await approveOutreach(ctx, input.outreachId);
        return NextResponse.json({ ok: true });
      case 'cancelOutreach':
        await cancelOutreach(ctx, input.outreachId);
        return NextResponse.json({ ok: true });
      case 'markSent':
        await markSent(ctx, input.outreachId);
        return NextResponse.json({ ok: true });
      case 'stopSequence':
        await stopSequence(ctx, input.id);
        return NextResponse.json({ ok: true });
      case 'recordReply':
        return NextResponse.json(await recordReply(ctx, input.id, input.text));
      case 'saveContact': {
        const contact = await saveContact(ctx, input.id, {
          phone: input.phone,
          timezone: input.timezone,
          smsConsent: input.smsConsent,
          consentNote: input.consentNote,
        });
        return NextResponse.json({ contact });
      }
      case 'logCall':
        return NextResponse.json({
          call: await logCall(ctx, input.id, {
            calledAt: new Date(input.calledAt),
            outcome: input.outcome,
            notes: input.notes,
            nextStep: input.nextStep,
            nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
          }),
        });
      case 'sendSms':
        return NextResponse.json(await sendInvestorSms(ctx, input.id, input.body));
      case 'optOut':
        await optOutInvestor(ctx, input.id, 'Investor Hub: marked do-not-contact by owner');
        return NextResponse.json({ ok: true });
      case 'createCampaign':
        return NextResponse.json(await createCampaign(ctx, { ...input.campaign, investorIds: input.investorIds }), { status: 201 });
      case 'updateCampaign':
        return NextResponse.json(await updateCampaign(ctx, input.campaignId, { ...input.campaign, investorIds: input.investorIds }));
      case 'generateCampaignTemplate':
        return NextResponse.json(await generateCampaignTemplate(ctx));
      case 'approveCampaign':
        await approveCampaign(ctx, input.campaignId, input.acknowledged);
        return NextResponse.json({ ok: true });
      case 'pauseCampaign':
        await pauseCampaign(ctx, input.campaignId);
        return NextResponse.json({ ok: true });
      case 'resumeCampaign':
        await resumeCampaign(ctx, input.campaignId);
        return NextResponse.json({ ok: true });
      case 'stopCampaign':
        await stopCampaign(ctx, input.campaignId);
        return NextResponse.json({ ok: true });
      case 'recordConsent':
        return NextResponse.json({ consent: await recordConsent(ctx, input.id, { type: input.type, evidence: input.evidence, obtainedAt: new Date(input.obtainedAt) }) });
      case 'revokeConsent':
        await revokeConsent(ctx, input.id, input.type);
        return NextResponse.json({ ok: true });
      case 'startAiCall':
        return NextResponse.json(await startAiCall(ctx, input.id, { confirmed: input.confirmed, transferNumber: input.transferNumber }));
    }
  } catch (error) {
    return fail(error);
  }
}
