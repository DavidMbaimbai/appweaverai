import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { type ImportedInvestor, toCsv } from './csv';
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  type InvestorType,
  type PipelineStage,
} from './constants';
import { advanceStage, emailKey, normalizeDomain } from './logic';
import { scoreInvestor, type ScoreProfile } from './score';

/** Every query in the hub is scoped by BOTH user and project. */
export type Ctx = { userId: string; projectId: string };

const scope = (ctx: Ctx) => ({ userId: ctx.userId, projectId: ctx.projectId });

export class HubError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ---------- Profile ----------

export type ProfileInput = {
  companyName?: string;
  website?: string;
  description?: string;
  sector?: string;
  stage?: string;
  amountSought?: number | null;
  currency?: string;
  geography?: string;
  traction?: string;
  useOfFunds?: string;
};

export async function getProfile(ctx: Ctx) {
  return prisma.investorHubProfile.findUnique({
    where: { userId_projectId: scope(ctx) },
  });
}

export async function saveProfile(ctx: Ctx, input: ProfileInput) {
  const profile = await prisma.investorHubProfile.upsert({
    where: { userId_projectId: scope(ctx) },
    create: { ...scope(ctx), ...input },
    update: input,
  });
  await rescoreAll(ctx, profile);
  return profile;
}

// ---------- Investors ----------

export type InvestorInput = {
  name: string;
  firm?: string | null;
  type?: InvestorType;
  website?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  focus?: string | null;
  sectors?: string[];
  stages?: string[];
  geographies?: string[];
  instruments?: string[];
  ticketMin?: number | null;
  ticketMax?: number | null;
  portfolio?: string[];
  tags?: string[];
};

export type Provenance = { sourceUrl: string | null; verifiedAt: Date | null };

const PROVENANCE_FIELDS = [
  'email',
  'website',
  'linkedinUrl',
  'focus',
  'sectors',
  'stages',
  'geographies',
  'instruments',
  'ticketMin',
  'ticketMax',
  'portfolio',
] as const;

/** Every populated field carries its source URL and last-verified date; scraped data is always unverified. */
export function buildFieldMeta(input: InvestorInput, source: Provenance) {
  const meta: Record<string, { sourceUrl: string | null; lastVerifiedAt: string | null; verified: boolean }> = {};
  for (const field of PROVENANCE_FIELDS) {
    const value = input[field];
    const present = Array.isArray(value) ? value.length > 0 : value != null && value !== '';
    if (present) {
      meta[field] = {
        sourceUrl: source.sourceUrl,
        lastVerifiedAt: source.verifiedAt?.toISOString() ?? null,
        verified: false,
      };
    }
  }
  return meta;
}

export async function findDuplicate(ctx: Ctx, domain: string | null, key: string | null) {
  const or: Prisma.HubInvestorWhereInput[] = [];
  if (domain) or.push({ domain });
  if (key) or.push({ emailKey: key });
  if (!or.length) return null;
  return prisma.hubInvestor.findFirst({
    where: { ...scope(ctx), OR: or },
    select: { id: true },
  });
}

export async function logActivity(ctx: Ctx, investorId: string, type: string, summary: string) {
  await prisma.hubInvestorActivity.create({
    data: { ...scope(ctx), investorId, type, summary: summary.slice(0, 2000) },
  });
}

/** Creates an investor unless the normalised domain or email already exists in this project. */
export async function addInvestor(
  ctx: Ctx,
  input: InvestorInput,
  source: Provenance = { sourceUrl: null, verifiedAt: null },
): Promise<{ created: boolean; id: string }> {
  const domain = normalizeDomain(input.website);
  const key = emailKey(input.email);
  const dupe = await findDuplicate(ctx, domain, key);
  if (dupe) return { created: false, id: dupe.id };

  const suppressed = key
    ? await prisma.outreachSuppression.findUnique({ where: { email: key } })
    : null;
  const profile = await getProfile(ctx);
  const result = scoreInvestor(profile ?? {}, input);

  const created = await prisma.hubInvestor.create({
    data: {
      ...scope(ctx),
      name: input.name,
      firm: input.firm ?? null,
      type: input.type ?? 'OTHER',
      website: input.website ?? null,
      domain,
      email: key,
      emailKey: key,
      linkedinUrl: input.linkedinUrl ?? null,
      focus: input.focus ?? null,
      sectors: input.sectors ?? [],
      stages: input.stages ?? [],
      geographies: input.geographies ?? [],
      instruments: input.instruments ?? [],
      ticketMin: input.ticketMin ?? null,
      ticketMax: input.ticketMax ?? null,
      portfolio: input.portfolio ?? [],
      tags: input.tags ?? [],
      sourceUrl: source.sourceUrl,
      lastVerifiedAt: source.verifiedAt,
      fieldMeta: buildFieldMeta(input, source),
      score: result.score,
      scoreDetail: result as unknown as Prisma.InputJsonValue,
      optedOut: Boolean(suppressed),
    },
    select: { id: true },
  });
  await logActivity(
    ctx,
    created.id,
    'created',
    source.sourceUrl ? `Discovered from ${source.sourceUrl} (unverified).` : 'Added manually.',
  );
  return { created: true, id: created.id };
}

export type InvestorFilters = {
  q?: string;
  stage?: PipelineStage;
  type?: InvestorType;
  tag?: string;
  minScore?: number;
  dueOnly?: boolean;
};

export async function listInvestors(ctx: Ctx, f: InvestorFilters = {}) {
  const where: Prisma.HubInvestorWhereInput = { ...scope(ctx) };
  if (f.stage) where.pipelineStage = f.stage;
  if (f.type) where.type = f.type;
  if (f.tag) where.tags = { has: f.tag };
  if (f.minScore != null) where.score = { gte: f.minScore };
  if (f.dueOnly) where.nextFollowUpAt = { lte: new Date() };
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { firm: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { focus: { contains: q, mode: 'insensitive' } },
      { tags: { has: q } },
    ];
  }
  return prisma.hubInvestor.findMany({
    where,
    orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: 500,
  });
}

/** Owner-scoped lookup; throws 404 for rows that belong to another user or project. */
export async function requireInvestor(ctx: Ctx, id: string) {
  const investor = await prisma.hubInvestor.findFirst({ where: { id, ...scope(ctx) } });
  if (!investor) throw new HubError('Investor not found.', 404);
  return investor;
}

export async function getInvestorDetail(ctx: Ctx, id: string) {
  await requireInvestor(ctx, id);
  const [investor, activities, outreach, replies] = await Promise.all([
    prisma.hubInvestor.findFirst({ where: { id, ...scope(ctx) } }),
    prisma.hubInvestorActivity.findMany({
      where: { investorId: id, ...scope(ctx) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.hubInvestorOutreach.findMany({
      where: { investorId: id, ...scope(ctx) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.hubInvestorReply.findMany({
      where: { investorId: id, ...scope(ctx) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  return { investor, activities, outreach, replies };
}

export type InvestorPatch = {
  stage?: PipelineStage;
  tags?: string[];
  nextFollowUpAt?: Date | null;
  verified?: boolean;
  name?: string;
  firm?: string | null;
  email?: string | null;
  confirmFunding?: boolean;
  fundingAmount?: number | null;
};

export async function updateInvestor(ctx: Ctx, id: string, patch: InvestorPatch) {
  const current = await requireInvestor(ctx, id);
  const data: Prisma.HubInvestorUpdateManyMutationInput = {};

  if (patch.tags) data.tags = [...new Set(patch.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
  if (patch.nextFollowUpAt !== undefined) data.nextFollowUpAt = patch.nextFollowUpAt;
  if (patch.name) data.name = patch.name.slice(0, 200);
  if (patch.firm !== undefined) data.firm = patch.firm;
  if (patch.verified !== undefined) {
    data.verified = patch.verified;
    data.lastVerifiedAt = patch.verified ? new Date() : current.lastVerifiedAt;
  }
  if (patch.email !== undefined) {
    const key = emailKey(patch.email);
    if (key && key !== current.emailKey) {
      const dupe = await findDuplicate(ctx, null, key);
      if (dupe && dupe.id !== id) throw new HubError('Another investor already uses that email.', 409);
    }
    data.email = key;
    data.emailKey = key;
  }
  if (patch.stage && patch.stage !== current.pipelineStage) {
    if (patch.stage === 'FUNDING_SECURED') {
      if (!patch.confirmFunding) throw new HubError('Confirm that funding was actually secured.', 400);
      data.fundingConfirmed = true;
      data.fundingAmount = patch.fundingAmount ?? null;
    }
    data.pipelineStage = patch.stage;
  }

  await prisma.hubInvestor.updateMany({ where: { id, ...scope(ctx) }, data });
  if (patch.stage && patch.stage !== current.pipelineStage) {
    await logActivity(ctx, id, `stage:${patch.stage}`, `Stage changed to ${STAGE_LABELS[patch.stage]}.`);
  }
  if (patch.nextFollowUpAt !== undefined) {
    await logActivity(
      ctx,
      id,
      'reminder',
      patch.nextFollowUpAt ? `Follow-up reminder set for ${patch.nextFollowUpAt.toISOString().slice(0, 10)}.` : 'Follow-up reminder cleared.',
    );
  }
  return requireInvestor(ctx, id);
}

export async function addNote(ctx: Ctx, id: string, text: string) {
  await requireInvestor(ctx, id);
  await logActivity(ctx, id, 'note', text);
}

export async function deleteInvestor(ctx: Ctx, id: string) {
  await requireInvestor(ctx, id);
  await prisma.hubInvestorContact.deleteMany({ where: { investorId: id, ...scope(ctx) } });
  await prisma.hubInvestorCall.deleteMany({ where: { investorId: id, ...scope(ctx) } });
  await prisma.hubInvestorSms.deleteMany({ where: { investorId: id, ...scope(ctx) } });
  await prisma.hubInvestor.deleteMany({ where: { id, ...scope(ctx) } });
}

export async function rescoreAll(ctx: Ctx, profile?: ScoreProfile | null) {
  const p = profile ?? (await getProfile(ctx)) ?? {};
  const investors = await prisma.hubInvestor.findMany({ where: scope(ctx), take: 1000 });
  for (const inv of investors) {
    const result = scoreInvestor(p, inv);
    await prisma.hubInvestor.updateMany({
      where: { id: inv.id, ...scope(ctx) },
      data: { score: result.score, scoreDetail: result as unknown as Prisma.InputJsonValue },
    });
  }
}

/** Forward-only stage move for automated events; logs a `stage:` activity used by analytics. */
export async function applyStage(ctx: Ctx, id: string, current: PipelineStage, target: PipelineStage, reason: string) {
  const next = advanceStage(current, target);
  if (next === current) return current;
  await prisma.hubInvestor.updateMany({
    where: { id, ...scope(ctx) },
    data: { pipelineStage: next },
  });
  await logActivity(ctx, id, `stage:${next}`, `${reason} Stage: ${STAGE_LABELS[next]}.`);
  return next;
}

// ---------- CSV ----------

export async function importInvestors(ctx: Ctx, rows: ImportedInvestor[]) {
  let created = 0;
  let duplicates = 0;
  for (const row of rows) {
    const result = await addInvestor(ctx, row);
    if (result.created) created += 1;
    else duplicates += 1;
  }
  return { created, duplicates };
}

export async function exportInvestorsCsv(ctx: Ctx) {
  const investors = await prisma.hubInvestor.findMany({
    where: scope(ctx),
    orderBy: { createdAt: 'asc' },
    take: 5000,
  });
  return toCsv(
    ['name', 'firm', 'type', 'email', 'website', 'linkedin', 'stage', 'score', 'tags', 'verified', 'last_verified_at', 'source_url', 'sectors', 'stages', 'geographies', 'ticket_min', 'ticket_max'],
    investors.map((i) => [
      i.name,
      i.firm,
      i.type,
      i.email,
      i.website,
      i.linkedinUrl,
      STAGE_LABELS[i.pipelineStage as PipelineStage] ?? i.pipelineStage,
      i.score,
      i.tags.join(';'),
      i.verified ? 'verified' : 'unverified',
      i.lastVerifiedAt?.toISOString() ?? '',
      i.sourceUrl,
      i.sectors.join(';'),
      i.stages.join(';'),
      i.geographies.join(';'),
      i.ticketMin,
      i.ticketMax,
    ]),
  );
}

// ---------- Analytics ----------

export type Funnel = {
  discovered: number;
  qualified: number;
  contacted: number;
  sent: number;
  replied: number;
  meetings: number;
  deckRequests: number;
  fundingSecured: number;
};

/** Investors that reached a stage at or beyond `from` (never counting a decline as progress). */
export function everReached(
  events: Array<{ investorId: string; type: string }>,
  current: Array<{ id: string; pipelineStage: PipelineStage }>,
  from: PipelineStage,
) {
  const rank = (s: string) => PIPELINE_STAGES.indexOf(s as PipelineStage);
  const min = rank(from);
  const ids = new Set<string>();
  for (const e of events) {
    if (!e.type.startsWith('stage:')) continue;
    const stage = e.type.slice(6);
    if (stage !== 'DECLINED' && rank(stage) >= min) ids.add(e.investorId);
  }
  for (const c of current) {
    if (c.pipelineStage !== 'DECLINED' && rank(c.pipelineStage) >= min) ids.add(c.id);
  }
  return ids.size;
}

export async function getAnalytics(ctx: Ctx): Promise<Funnel & { byStage: Record<string, number>; byType: Record<string, number> }> {
  const where = scope(ctx);
  const [investors, events, sent, replies] = await Promise.all([
    prisma.hubInvestor.findMany({
      where,
      select: { id: true, pipelineStage: true, type: true, fundingConfirmed: true },
      take: 5000,
    }),
    prisma.hubInvestorActivity.findMany({
      where: { ...where, type: { startsWith: 'stage:' } },
      select: { investorId: true, type: true },
      take: 20000,
    }),
    prisma.hubInvestorOutreach.findMany({
      where: { ...where, status: 'SENT' },
      select: { investorId: true },
      take: 20000,
    }),
    prisma.hubInvestorReply.findMany({
      where,
      select: { investorId: true, classification: true },
      take: 20000,
    }),
  ]);
  const current = investors.map((i) => ({ id: i.id, pipelineStage: i.pipelineStage as PipelineStage }));
  const byStage: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const i of investors) {
    byStage[i.pipelineStage] = (byStage[i.pipelineStage] ?? 0) + 1;
    byType[i.type] = (byType[i.type] ?? 0) + 1;
  }
  return {
    discovered: investors.length,
    qualified: everReached(events, current, 'QUALIFIED'),
    contacted: everReached(events, current, 'CONTACTED'),
    sent: new Set(sent.map((s) => s.investorId)).size,
    replied: new Set(replies.map((r) => r.investorId)).size,
    meetings: everReached(events, current, 'MEETING_SCHEDULED'),
    deckRequests: new Set(replies.filter((r) => r.classification === 'deck_requested').map((r) => r.investorId)).size,
    fundingSecured: investors.filter((i) => i.fundingConfirmed).length,
    byStage,
    byType,
  };
}

export async function exportAnalyticsCsv(ctx: Ctx) {
  const a = await getAnalytics(ctx);
  return toCsv(
    ['metric', 'count'],
    [
      ['discovered', a.discovered],
      ['qualified', a.qualified],
      ['contacted', a.contacted],
      ['emails_sent_manually_logged', a.sent],
      ['replied', a.replied],
      ['meetings', a.meetings],
      ['deck_requests', a.deckRequests],
      ['funding_secured_confirmed', a.fundingSecured],
      ...Object.entries(a.byStage).map(([k, v]) => [`stage_${k.toLowerCase()}`, v]),
    ],
  );
}
