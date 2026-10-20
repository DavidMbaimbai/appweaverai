import type { Meeting } from '@/lib/generated/prisma/client';
import type { PipelineStage } from '@/lib/investor-hub/constants';
import { applyStage, logActivity } from '@/lib/investor-hub/service';
import { prisma } from '@/lib/prisma';

import { notifyInApp } from './notify';

/** CRM side effects of a meeting becoming real. Called after a booking is confirmed; failures never undo the booking. */
export async function onMeetingConfirmed(m: Meeting): Promise<void> {
  if (m.sourceType !== 'INVESTOR' || !m.sourceId || !m.startsAt) return;
  const investor = await prisma.hubInvestor.findUnique({ where: { id: m.sourceId } });
  if (!investor || investor.projectId !== m.scopeId) return;
  const ctx = { userId: investor.userId, projectId: investor.projectId };
  await applyStage(ctx, investor.id, investor.pipelineStage as PipelineStage, 'MEETING_SCHEDULED', 'Meeting confirmed.');
  await logActivity(ctx, investor.id, 'meeting_confirmed', `Meeting "${m.title}" confirmed for ${m.startsAt.toISOString()}.`);
  await prisma.investorMeetingRequest.updateMany({ where: { investorId: investor.id, status: 'OPEN' }, data: { status: 'DONE' } });
}

/** After a meeting ends: record it on the investor and open a follow-up task for the owner. */
export async function onMeetingFinished(m: Meeting): Promise<void> {
  if (m.sourceType !== 'INVESTOR' || !m.sourceId) return;
  const investor = await prisma.hubInvestor.findUnique({ where: { id: m.sourceId } });
  if (!investor || investor.projectId !== m.scopeId) return;
  const ctx = { userId: investor.userId, projectId: investor.projectId };
  if (m.status === 'COMPLETED') {
    await logActivity(ctx, investor.id, 'meeting_completed', `Meeting "${m.title}" completed.`);
    await logActivity(ctx, investor.id, 'follow_up_task', 'Follow-up due: send thanks and the agreed next steps within 2 days.');
    await notifyInApp([investor.userId], m.id, `Follow up with ${investor.name}`, 'The meeting is complete. Review next steps and send a follow-up.');
  } else if (m.status === 'MISSED') {
    await logActivity(ctx, investor.id, 'meeting_missed', `Meeting "${m.title}" was missed.`);
  }
}
