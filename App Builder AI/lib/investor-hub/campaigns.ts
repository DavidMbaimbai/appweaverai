import { getAnthropicClient } from '@/lib/anthropic';
import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { scheduleSlotKey } from '@/lib/marketing-credits/budget';
import { withMarketingCredits } from '@/lib/marketing-credits/run';
import { normalizeEmail } from '@/lib/outreach/compliance';
import { sendEmail } from '@/lib/email';

import {
  campaignEmailConfigured,
  campaignSender,
  composeCampaignEmail,
} from './campaign-email';
import {
  campaignSendBlock,
  DEFAULT_FOLLOW_UP,
  firstName,
  insideCampaignWindow,
  MAX_DAILY_LIMIT,
  nextStepDelayDays,
  normalizeSettings,
  pickVariantIndex,
  renderTemplate,
  shouldPauseForBounces,
  targetBlockReason,
  unknownPlaceholders,
  type CampaignSettings,
} from './campaign-rules';
import type { PipelineStage } from './constants';
import { HUB_MODEL } from './extract';
import { buildFounderFacts } from './outreach';
import { applyStage, getProfile, HubError, logActivity, type Ctx } from './service';

const PER_RUN_MAX = 15;
const DAY_MS = 86_400_000;

type Variant = { subject: string; body: string };

type CampaignRow = Awaited<ReturnType<typeof prisma.investorCampaign.findFirstOrThrow>>;

const scope = (ctx: Ctx) => ({ userId: ctx.userId, projectId: ctx.projectId });

async function requireCampaign(ctx: Ctx, id: string) {
  const campaign = await prisma.investorCampaign.findFirst({ where: { id, ...scope(ctx) } });
  if (!campaign) throw new HubError('Campaign not found.', 404);
  return campaign;
}

function variantsOf(c: Pick<CampaignRow, 'templateSubject' | 'templateBody' | 'variants'>): Variant[] {
  const extra = Array.isArray(c.variants) ? (c.variants as Array<Partial<Variant>>) : [];
  return [
    { subject: c.templateSubject, body: c.templateBody },
    ...extra.filter((v) => typeof v?.subject === 'string' && typeof v?.body === 'string').map((v) => ({ subject: v.subject!, body: v.body! })),
  ].filter((v) => v.subject.trim() && v.body.trim());
}

function templateProblems(subject: string, bodies: string[]): string | null {
  if (!subject.trim() || !bodies.some((b) => b.trim())) return 'Add a subject and a message body.';
  const all = [subject, ...bodies].join('\n');
  const unknown = unknownPlaceholders(all);
  if (unknown.length) return `Unknown placeholder(s): ${unknown.map((u) => `{{${u}}}`).join(', ')}. Allowed: {{name}}, {{firstName}}, {{firm}}, {{company}}.`;
  if (/\[[^\]\n]{2,40}\]/.test(all)) return 'Replace bracketed placeholders such as [Your name] before saving.';
  if (/^\s*(re|fwd?):/i.test(subject)) return 'The subject must not start with "Re:" or "Fwd:".';
  return null;
}

/** Renders one step for one target exactly as it will be sent; null when a merge field is missing. */
export function renderStep(
  campaign: Pick<CampaignRow, 'templateSubject' | 'templateBody' | 'variants' | 'followUpBody'>,
  investor: { id: string; name: string; firm: string | null },
  company: string,
  step: number,
): Variant | null {
  const variants = variantsOf(campaign);
  if (!variants.length) return null;
  const vars = { name: investor.name, firstName: firstName(investor.name), firm: investor.firm, company };
  const chosen = variants[pickVariantIndex(investor.id, variants.length)];
  const subject = renderTemplate(chosen.subject, vars);
  if (subject === null) return null;
  if (step === 0) {
    const body = renderTemplate(chosen.body, vars);
    return body === null ? null : { subject, body };
  }
  const body = renderTemplate(campaign.followUpBody.trim() || DEFAULT_FOLLOW_UP, vars);
  return body === null ? null : { subject: `Following up: ${subject}`, body };
}

export type CampaignInput = {
  name: string;
  templateSubject: string;
  templateBody: string;
  variants?: Variant[];
  followUpBody?: string;
  settings?: Partial<CampaignSettings>;
};

function buildData(input: CampaignInput) {
  const variants = (input.variants ?? []).slice(0, 2);
  const problem = templateProblems(input.templateSubject, [input.templateBody, input.followUpBody ?? '', ...variants.map((v) => v.body)]);
  if (problem) throw new HubError(problem);
  const settings = normalizeSettings(input.settings ?? {});
  if (!settings.ok) throw new HubError(settings.error);
  return {
    name: input.name.trim().slice(0, 120) || 'Untitled campaign',
    templateSubject: input.templateSubject.trim().slice(0, 150),
    templateBody: input.templateBody.trim().slice(0, 3000),
    variants: variants.map((v) => ({ subject: v.subject.trim().slice(0, 150), body: v.body.trim().slice(0, 3000) })) as unknown as Prisma.InputJsonValue,
    followUpBody: (input.followUpBody ?? '').trim().slice(0, 2000),
    ...settings.value,
  };
}

/** Adds only investors that pass the eligibility rules; the rest are returned with the reason. */
async function addTargets(ctx: Ctx, campaignId: string, investorIds: string[]) {
  const skipped: Array<{ investorId: string; name: string; reason: string }> = [];
  let added = 0;
  const investors = await prisma.hubInvestor.findMany({ where: { id: { in: investorIds.slice(0, 500) }, ...scope(ctx) } });
  for (const inv of investors) {
    const email = inv.emailKey ?? inv.email;
    const meta = (inv.fieldMeta ?? {}) as Record<string, { sourceUrl?: string | null }>;
    const sourceUrl = meta.email?.sourceUrl || inv.sourceUrl;
    const suppressed = email ? Boolean(await prisma.outreachSuppression.findUnique({ where: { email: normalizeEmail(email) } })) : false;
    const reason = targetBlockReason({ email, sourceUrl, optedOut: inv.optedOut, suppressed });
    if (reason || !email || !sourceUrl) {
      skipped.push({ investorId: inv.id, name: inv.name, reason: reason ?? 'Not eligible.' });
      continue;
    }
    await prisma.investorCampaignTarget.upsert({
      where: { campaignId_investorId: { campaignId, investorId: inv.id } },
      create: { campaignId, investorId: inv.id, email: normalizeEmail(email), sourceUrl },
      update: {},
    });
    added += 1;
  }
  return { added, skipped };
}

export async function createCampaign(ctx: Ctx, input: CampaignInput & { investorIds: string[] }) {
  const data = buildData(input);
  const profile = await getProfile(ctx);
  if (!profile?.companyName.trim()) throw new HubError('Complete your company profile (name) before creating a campaign.');
  const campaign = await prisma.investorCampaign.create({ data: { ...scope(ctx), ...data } });
  const { added, skipped } = await addTargets(ctx, campaign.id, input.investorIds);
  return { campaign, added, skipped };
}

/** Any edit voids the earlier approval: the owner must approve the new content again. */
export async function updateCampaign(ctx: Ctx, id: string, input: CampaignInput & { investorIds?: string[] }) {
  const current = await requireCampaign(ctx, id);
  if (current.status === 'STOPPED' || current.status === 'DONE') throw new HubError('Finished campaigns cannot be edited.', 409);
  const data = buildData(input);
  await prisma.investorCampaign.updateMany({
    where: { id, ...scope(ctx) },
    data: { ...data, status: 'DRAFT', approvedAt: null, approvedBy: null, acknowledgedAt: null, pausedReason: null },
  });
  const result = input.investorIds ? await addTargets(ctx, id, input.investorIds) : { added: 0, skipped: [] };
  return result;
}

export async function listCampaigns(ctx: Ctx) {
  const campaigns = await prisma.investorCampaign.findMany({ where: scope(ctx), orderBy: { createdAt: 'desc' }, take: 50 });
  const out = [];
  for (const c of campaigns) out.push({ ...c, stats: await campaignStats(c.id) });
  return { campaigns: out, emailConfigured: campaignEmailConfigured() };
}

async function campaignStats(campaignId: string) {
  const [targets, sent, bounced, replied, active] = await Promise.all([
    prisma.investorCampaignTarget.count({ where: { campaignId } }),
    prisma.investorCampaignSend.count({ where: { campaignId, status: { in: ['SENT', 'BOUNCED'] } } }),
    prisma.investorCampaignSend.count({ where: { campaignId, status: 'BOUNCED' } }),
    prisma.investorCampaignTarget.count({ where: { campaignId, status: 'STOPPED_REPLY' } }),
    prisma.investorCampaignTarget.count({ where: { campaignId, status: 'ACTIVE' } }),
  ]);
  return { targets, sent, bounced, replied, active };
}

/** Preview shown before approval: counts plus three real, fully rendered emails (footer included). */
export async function previewCampaign(ctx: Ctx, id: string) {
  const campaign = await requireCampaign(ctx, id);
  const profile = await getProfile(ctx);
  const company = profile?.companyName.trim() ?? '';
  const targets = await prisma.investorCampaignTarget.findMany({ where: { campaignId: id, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, take: 500 });
  const investors = await prisma.hubInvestor.findMany({ where: { id: { in: targets.map((t) => t.investorId) }, ...scope(ctx) } });
  const byId = new Map(investors.map((i) => [i.id, i]));

  const renderable: Array<{ target: (typeof targets)[number]; email: ReturnType<typeof renderStep> }> = [];
  const unrenderable: string[] = [];
  for (const t of targets) {
    const inv = byId.get(t.investorId);
    const rendered = inv ? renderStep(campaign, inv, company, 0) : null;
    if (rendered) renderable.push({ target: t, email: rendered });
    else unrenderable.push(inv?.name ?? t.email);
  }
  const postal = process.env.OUTREACH_POSTAL_ADDRESS?.trim() || '[postal address not configured]';
  const picks = renderable.length <= 3 ? renderable : [renderable[0], renderable[Math.floor(renderable.length / 2)], renderable[renderable.length - 1]];
  const samples = picks.map(({ target, email }) => {
    let text = email!.body;
    try {
      text = composeCampaignEmail({ body: email!.body, to: target.email, sourceUrl: target.sourceUrl, postalAddress: postal, company }).text;
    } catch {
      // Unsubscribe secret missing: surfaced through emailConfigured=false.
    }
    return { to: target.email, subject: email!.subject, text };
  });
  const followUp = renderable[0] ? renderStep(campaign, byId.get(renderable[0].target.investorId)!, company, 1) : null;
  return {
    campaign,
    targetCount: targets.length,
    unrenderable,
    samples,
    followUpSample: followUp,
    emailConfigured: campaignEmailConfigured(),
    sender: campaignSender().from,
  };
}

export async function approveCampaign(ctx: Ctx, id: string, acknowledged: boolean) {
  const campaign = await requireCampaign(ctx, id);
  if (!acknowledged) {
    throw new HubError('Tick the acknowledgement: you confirm you are the sender and that the message complies with applicable anti-spam and privacy law.');
  }
  if (campaign.status !== 'DRAFT') throw new HubError('Only a draft campaign can be approved.', 409);
  const preview = await previewCampaign(ctx, id);
  if (!preview.targetCount) throw new HubError('Add at least one eligible target (public business email with a source URL).');
  if (!preview.samples.length) throw new HubError('No target can be rendered with this template; check the merge fields.');
  const now = new Date();
  await prisma.investorCampaign.updateMany({
    where: { id, ...scope(ctx), status: 'DRAFT' },
    data: { status: 'APPROVED', approvedAt: now, approvedBy: ctx.userId, acknowledgedAt: now, pausedReason: null },
  });
  await prisma.investorCampaignTarget.updateMany({ where: { campaignId: id, status: 'ACTIVE', nextSendAt: null }, data: { nextSendAt: now } });
}

/** Pause/stop take effect immediately: the sender re-reads status before every message. */
export async function pauseCampaign(ctx: Ctx, id: string, reason = 'Paused by you.') {
  await requireCampaign(ctx, id);
  await prisma.investorCampaign.updateMany({
    where: { id, ...scope(ctx), status: { in: ['APPROVED', 'RUNNING'] } },
    data: { status: 'PAUSED', pausedReason: reason },
  });
}

export async function resumeCampaign(ctx: Ctx, id: string) {
  const c = await requireCampaign(ctx, id);
  if (c.status !== 'PAUSED' || !c.approvedAt) throw new HubError('Only a paused, approved campaign can be resumed.', 409);
  await prisma.investorCampaign.updateMany({ where: { id, ...scope(ctx), status: 'PAUSED' }, data: { status: 'RUNNING', pausedReason: null } });
}

export async function stopCampaign(ctx: Ctx, id: string) {
  await requireCampaign(ctx, id);
  await prisma.investorCampaign.updateMany({ where: { id, ...scope(ctx), status: { not: 'DONE' } }, data: { status: 'STOPPED', pausedReason: 'Stopped by you.' } });
  await prisma.investorCampaignTarget.updateMany({
    where: { campaignId: id, status: 'ACTIVE' },
    data: { status: 'STOPPED_MANUAL', stopReason: 'Campaign stopped', nextSendAt: null },
  });
}

/** Drafts reusable templates from the founder profile only (merge fields instead of invented facts). */
export async function generateCampaignTemplate(ctx: Ctx) {
  const profile = await getProfile(ctx);
  if (!profile?.companyName.trim() || !profile.description.trim()) {
    throw new HubError('Complete your company profile (name and description) first.');
  }
  const response = await getAnthropicClient().messages.create({
    model: HUB_MODEL,
    max_tokens: 1500,
    system: `You draft ONE reusable first-contact email template (90-140 words) for a startup founder writing to investors.
- Use ONLY facts inside <founder_facts>. Never invent traction, revenue, customers, metrics, amounts, mutual contacts or prior relationships; do not claim to know the recipient.
- Personalise only with these merge fields: {{firstName}}, {{firm}}, {{company}}. Do not mention the investor's focus or portfolio.
- One low-pressure ask. No "Re:"/"Fwd:" subject, no pressure, no brackets. End with "Best regards," and no name. No unsubscribe line (appended automatically).
Return ONLY JSON: {"subject": string, "body": string}.`,
    messages: [{ role: 'user', content: `<founder_facts>\n${buildFounderFacts(profile).slice(0, 4000)}\n</founder_facts>` }],
  });
  const block = response.content.find((c) => c.type === 'text');
  const match = block && block.type === 'text' ? block.text.match(/\{[\s\S]*\}/) : null;
  try {
    const parsed = JSON.parse(match?.[0] ?? '') as { subject?: unknown; body?: unknown };
    if (typeof parsed.subject === 'string' && typeof parsed.body === 'string' && !templateProblems(parsed.subject, [parsed.body])) {
      return { subject: parsed.subject.trim().slice(0, 150), body: parsed.body.trim().slice(0, 3000) };
    }
  } catch {
    // fall through
  }
  throw new HubError('The model returned no usable template. Try again or write your own.', 502);
}

/** Records the opt-out on every CRM record and stops every active campaign target for this address. */
export async function applyEmailOptOut(email: string, reason = 'Opted out by email') {
  const address = normalizeEmail(email);
  await prisma.hubInvestor.updateMany({
    where: { emailKey: address },
    data: { optedOut: true, sequenceActive: false, nextFollowUpAt: null },
  });
  await prisma.investorCampaignTarget.updateMany({
    where: { email: address, status: 'ACTIVE' },
    data: { status: 'STOPPED_OPTOUT', stopReason: reason, nextSendAt: null },
  });
}

async function advanceTarget(
  campaign: CampaignRow,
  target: { id: string; stepsSent: number },
  step: number,
  now: Date,
) {
  const stepsSent = Math.max(target.stepsSent, step + 1);
  const delay = nextStepDelayDays(stepsSent, campaign.followUpDays, campaign.maxFollowUps);
  await prisma.investorCampaignTarget.update({
    where: { id: target.id },
    data: {
      stepsSent,
      lastSentAt: now,
      nextSendAt: delay === null ? null : new Date(now.getTime() + delay * DAY_MS),
      ...(delay === null ? { status: 'COMPLETED', stopReason: 'Sequence complete' } : {}),
    },
  });
}

export type CampaignRunSummary = {
  campaigns: number;
  sent: number;
  skipped: number;
  failed: number;
  paused: number;
  dryRun: boolean;
  wouldSend: number;
};

/** Cron entry: sends due emails for approved campaigns inside limits and window. */
export async function runInvestorCampaigns(now = new Date()): Promise<CampaignRunSummary> {
  const summary: CampaignRunSummary = { campaigns: 0, sent: 0, skipped: 0, failed: 0, paused: 0, dryRun: false, wouldSend: 0 };
  const configured = campaignEmailConfigured();
  const campaigns = await prisma.investorCampaign.findMany({ where: { status: { in: ['APPROVED', 'RUNNING'] } }, take: 50 });

  for (const campaign of campaigns) {
    if (!campaign.approvedAt || !campaign.acknowledgedAt) continue;
    summary.campaigns += 1;
    if (campaign.status === 'APPROVED') {
      await prisma.investorCampaign.updateMany({ where: { id: campaign.id, status: 'APPROVED' }, data: { status: 'RUNNING' } });
    }

    const [sentCount, bouncedCount] = await Promise.all([
      prisma.investorCampaignSend.count({ where: { campaignId: campaign.id, status: { in: ['SENT', 'BOUNCED'] } } }),
      prisma.investorCampaignSend.count({ where: { campaignId: campaign.id, status: 'BOUNCED' } }),
    ]);
    if (shouldPauseForBounces(sentCount, bouncedCount)) {
      await prisma.investorCampaign.updateMany({
        where: { id: campaign.id },
        data: { status: 'PAUSED', pausedReason: `Auto-paused: ${bouncedCount} of ${sentCount} emails bounced (limit 5%). Check your list.` },
      });
      summary.paused += 1;
      continue;
    }
    if (!insideCampaignWindow(now, campaign.timezone, campaign.sendWindowStart, campaign.sendWindowEnd)) continue;

    const since = new Date(now.getTime() - DAY_MS);
    const siblings = await prisma.investorCampaign.findMany({ where: { projectId: campaign.projectId, userId: campaign.userId }, select: { id: true } });
    const [campaignToday, projectToday] = await Promise.all([
      prisma.investorCampaignSend.count({ where: { campaignId: campaign.id, createdAt: { gte: since } } }),
      prisma.investorCampaignSend.count({ where: { campaignId: { in: siblings.map((s) => s.id) }, createdAt: { gte: since } } }),
    ]);
    const remaining = Math.min(campaign.dailyLimit - campaignToday, MAX_DAILY_LIMIT - projectToday, PER_RUN_MAX);
    if (remaining <= 0) continue;

    const due = await prisma.investorCampaignTarget.findMany({
      where: { campaignId: campaign.id, status: 'ACTIVE', nextSendAt: { lte: now } },
      orderBy: { nextSendAt: 'asc' },
      take: remaining,
    });
    if (!due.length) {
      const active = await prisma.investorCampaignTarget.count({ where: { campaignId: campaign.id, status: 'ACTIVE' } });
      if (!active) await prisma.investorCampaign.updateMany({ where: { id: campaign.id, status: { in: ['RUNNING', 'APPROVED'] } }, data: { status: 'DONE' } });
      continue;
    }
    if (!configured) {
      // No pretend sends: nothing is claimed or advanced until email is fully configured.
      summary.dryRun = true;
      summary.wouldSend += due.length;
      console.info(`[investor-campaigns] DRY RUN: ${due.length} email(s) due for campaign ${campaign.id}; email is not configured.`);
      continue;
    }

    const ctx: Ctx = { userId: campaign.userId, projectId: campaign.projectId };
    const profile = await getProfile(ctx);
    const company = profile?.companyName.trim() ?? '';
    const postalAddress = process.env.OUTREACH_POSTAL_ADDRESS!.trim();

    for (const target of due) {
      // Pause/stop must be instant: re-read status before every single message.
      const fresh = await prisma.investorCampaign.findUnique({ where: { id: campaign.id }, select: { status: true } });
      if (fresh?.status !== 'RUNNING') break;

      const gate = await withMarketingCredits(
        {
          userId: campaign.userId,
          projectId: campaign.projectId,
          operation: 'campaign_send',
          scheduled: true,
          retryable: true,
          idempotencyKey: scheduleSlotKey(`inv-campaign:${campaign.id}`, `${target.id}:${target.stepsSent}`, 'campaign_send'),
          refType: 'InvestorCampaignTarget',
          refId: target.id,
          isFailure: (r: 'sent' | 'skipped' | 'failed') => r !== 'sent',
        },
        () => sendToTarget({ campaign, target, ctx, company, postalAddress, now }),
      );
      if (!gate.ok) {
        // Budget or balance reached: the schedule is paused (owner notified); nothing else is sent this run.
        if (gate.reason !== 'duplicate') {
          summary.paused += 1;
          break;
        }
        summary.skipped += 1;
        continue;
      }
      summary[gate.value] += 1;
    }

    const active = await prisma.investorCampaignTarget.count({ where: { campaignId: campaign.id, status: 'ACTIVE' } });
    if (!active) await prisma.investorCampaign.updateMany({ where: { id: campaign.id, status: 'RUNNING' }, data: { status: 'DONE' } });
  }
  return summary;
}

type DueTarget = Awaited<ReturnType<typeof prisma.investorCampaignTarget.findFirstOrThrow>>;

/** Sends one step to one target after every guardrail is re-checked against fresh state. */
export async function sendToTarget(args: {
  campaign: CampaignRow;
  target: DueTarget;
  ctx: Ctx;
  company: string;
  postalAddress: string;
  now: Date;
}): Promise<'sent' | 'skipped' | 'failed'> {
  const { campaign, target, ctx, company, postalAddress, now } = args;
  const stop = (status: string, reason: string) =>
    prisma.investorCampaignTarget.update({ where: { id: target.id }, data: { status, stopReason: reason, nextSendAt: null } });

  const investor = await prisma.hubInvestor.findFirst({ where: { id: target.investorId, ...scope(ctx) } });
  if (!investor) {
    await stop('STOPPED_MANUAL', 'Investor removed');
    return 'skipped';
  }
  const email = normalizeEmail(target.email);
  if (investor.emailKey !== email) {
    await stop('STOPPED_MANUAL', 'Investor email changed after approval');
    return 'skipped';
  }

  const step = target.stepsSent;
  const [suppressed, replyCount, existing] = await Promise.all([
    prisma.outreachSuppression.findUnique({ where: { email } }),
    prisma.hubInvestorReply.count({ where: { investorId: investor.id } }),
    prisma.investorCampaignSend.findUnique({ where: { targetId_step: { targetId: target.id, step } } }),
  ]);

  const block = campaignSendBlock({
    campaignStatus: 'RUNNING',
    targetStatus: target.status,
    optedOut: investor.optedOut,
    sequenceActive: investor.sequenceActive,
    suppressed: Boolean(suppressed),
    replied: replyCount > 0,
    alreadySentStep: Boolean(existing),
    step,
    maxFollowUps: campaign.maxFollowUps,
  });
  if (block) {
    if (existing) await advanceTarget(campaign, target, step, now);
    else if (block.stop) await stop(block.stop, block.reason);
    return 'skipped';
  }

  const eligibility = targetBlockReason({ email, sourceUrl: target.sourceUrl, optedOut: false, suppressed: false });
  const rendered = eligibility ? null : renderStep(campaign, investor, company, step);
  if (!rendered) {
    await stop('SKIPPED', eligibility ?? 'A merge field has no value for this investor');
    return 'skipped';
  }

  // Claim the (target, step) slot first; the unique index makes a second claim fail.
  try {
    await prisma.investorCampaignSend.create({
      data: { campaignId: campaign.id, targetId: target.id, step, subject: rendered.subject, body: rendered.body },
    });
  } catch {
    return 'skipped';
  }

  try {
    const message = composeCampaignEmail({ body: rendered.body, to: email, sourceUrl: target.sourceUrl, postalAddress, company });
    await sendEmail({
      to: email,
      from: campaignSender().from,
      subject: rendered.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    });
  } catch (error) {
    // Nothing was delivered: release the claim and retry in an hour.
    await prisma.investorCampaignSend.deleteMany({ where: { targetId: target.id, step, status: 'SENDING' } });
    await prisma.investorCampaignTarget.update({
      where: { id: target.id },
      data: { nextSendAt: new Date(now.getTime() + 3_600_000), stopReason: `Last send failed: ${String(error).slice(0, 200)}` },
    });
    return 'failed';
  }

  await prisma.investorCampaignSend.updateMany({ where: { targetId: target.id, step }, data: { status: 'SENT' } });
  await advanceTarget(campaign, target, step, now);
  await prisma.hubInvestorOutreach.create({
    data: {
      ...scope(ctx),
      investorId: investor.id,
      kind: step === 0 ? 'EMAIL' : 'FOLLOW_UP',
      subject: rendered.subject,
      body: rendered.body,
      status: 'SENT',
      approvedAt: campaign.approvedAt,
      sentAt: now,
    },
  });
  await logActivity(ctx, investor.id, 'sent', `Campaign "${campaign.name}" auto-sent ${step === 0 ? 'the first email' : `follow-up ${step}`} to ${email} (campaign approved by owner).`);
  await applyStage(ctx, investor.id, investor.pipelineStage as PipelineStage, 'CONTACTED', 'Campaign email sent.');
  return 'sent';
}
