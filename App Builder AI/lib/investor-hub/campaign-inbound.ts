import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '@/lib/outreach/compliance';
import { suppress } from '@/lib/outreach/process';

import { extractEmails, isBounceSender, needsHumanReply } from './campaign-rules';
import { recordReply } from './replies';
import type { Ctx } from './service';

export type InboundResult = { handled: boolean; needsHuman: boolean };

/**
 * Called by the support inbox poller before any auto-reply. Replies from campaign targets are
 * classified and logged but NEVER answered automatically; bounces stop the sequence.
 */
export async function handleCampaignInbound(input: {
  from: string | undefined | null;
  subject?: string | null;
  body?: string | null;
}): Promise<InboundResult> {
  const none = { handled: false, needsHuman: false };
  if (!input.from) return none;
  const body = input.body?.trim() ?? '';

  if (isBounceSender(input.from)) {
    let handled = false;
    for (const address of extractEmails(`${input.subject ?? ''}\n${body}`)) {
      const targets = await prisma.investorCampaignTarget.findMany({ where: { email: address }, select: { id: true } });
      if (!targets.length) continue;
      handled = true;
      await prisma.investorCampaignTarget.updateMany({
        where: { email: address, status: { in: ['ACTIVE', 'COMPLETED'] } },
        data: { status: 'STOPPED_BOUNCE', stopReason: 'Email bounced', nextSendAt: null },
      });
      for (const t of targets) {
        const last = await prisma.investorCampaignSend.findFirst({ where: { targetId: t.id, status: 'SENT' }, orderBy: { createdAt: 'desc' } });
        if (last) await prisma.investorCampaignSend.update({ where: { id: last.id }, data: { status: 'BOUNCED' } });
      }
      await suppress(address, 'Hard bounce from an investor campaign').catch(() => undefined);
    }
    return { handled, needsHuman: false };
  }

  const address = normalizeEmail(input.from);
  const targets = await prisma.investorCampaignTarget.findMany({ where: { email: address }, select: { investorId: true, campaignId: true } });
  if (!targets.length) return none;

  await prisma.investorCampaignTarget.updateMany({
    where: { email: address, status: 'ACTIVE' },
    data: { status: 'STOPPED_REPLY', stopReason: 'Contact replied', nextSendAt: null },
  });

  let needsHuman = false;
  const investors = await prisma.hubInvestor.findMany({ where: { id: { in: targets.map((t) => t.investorId) }, emailKey: address } });
  for (const investor of investors) {
    const ctx: Ctx = { userId: investor.userId, projectId: investor.projectId };
    const { classification } = await recordReply(ctx, investor.id, `${input.subject ? `Subject: ${input.subject}\n\n` : ''}${body}`);
    if (!needsHumanReply(classification)) continue;
    needsHuman = true;
    // A draft only: a person must write and approve any answer to a substantive reply.
    await prisma.hubInvestorOutreach.create({
      data: {
        ...ctx,
        investorId: investor.id,
        kind: 'EMAIL',
        subject: input.subject ? (/^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`) : null,
        body: `Hi ${investor.name.split(/\s+/)[0]},\n\nThank you for your reply. [Write your answer here; the investor replied "${classification.replace('_', ' ')}"]`,
        status: 'DRAFT',
      },
    });
    await prisma.hubInvestorActivity.create({
      data: { ...ctx, investorId: investor.id, type: 'reply_needs_human', summary: `Reply (${classification.replace('_', ' ')}) needs your personal answer. Automation stopped; a draft is waiting.` },
    });
  }
  return { handled: true, needsHuman };
}
