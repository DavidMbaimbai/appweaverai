'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { approveActivity, rejectActivity } from '@/lib/agents/decisions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { UTM_KINDS, type UtmKind } from '@/lib/growth-bi/attribution';
import { ACTIVATION_KEY, parseActivation } from '@/lib/growth-bi/platform';
import { runNightly } from '@/lib/growth-bi/rollup';
import { createUtmLink, recommendForPlatform } from '@/lib/growth-bi/service';
import { prisma } from '@/lib/prisma';

type Out = { ok: true; message?: string; url?: string } | { ok: false; error: string };
const PATH = '/admin/growth';

export async function createUtmLinkAction(input: { baseUrl: string; source: string; medium: string; campaign: string; content?: string; kind: string; label?: string }): Promise<Out> {
  const auth = await requireAdmin('growth:write');
  if (!auth.ok) return { ok: false, error: 'Not authorized.' };
  const kind = (UTM_KINDS as readonly string[]).includes(input.kind) ? (input.kind as UtmKind) : 'OTHER';
  const result = await createUtmLink(auth.admin.id, { ...input, kind });
  if (!result.ok) return result;
  revalidatePath(PATH);
  return { ok: true, url: result.url };
}

export async function saveActivationAction(input: { requireBuild: boolean; output: string }): Promise<Out> {
  const auth = await requireAdmin('growth:write');
  if (!auth.ok) return { ok: false, error: 'Not authorized.' };
  const value = parseActivation(input);
  await prisma.growthConfig.upsert({ where: { key: ACTIVATION_KEY }, create: { key: ACTIVATION_KEY, value }, update: { value } });
  await recordAuditLog({ adminId: auth.admin.id, adminEmail: auth.admin.email, action: 'growth.activation.update', targetType: 'GrowthConfig', after: value });
  revalidatePath(PATH);
  return { ok: true, message: 'Activation definition saved. It applies to all reports immediately.' };
}

export async function runRollupAction(days: number): Promise<Out> {
  const auth = await requireAdmin('growth:write');
  if (!auth.ok) return { ok: false, error: 'Not authorized.' };
  const result = await runNightly({ days: Math.min(Math.max(Math.floor(days) || 3, 1), 90) });
  revalidatePath(PATH);
  return { ok: true, message: `Recomputed ${result.days.length} day(s): ${result.platformRows} platform and ${result.projectRows} project rows.` };
}

export async function generatePlatformRecommendationsAction(): Promise<Out> {
  const auth = await requireAdmin('growth:write');
  if (!auth.ok) return { ok: false, error: 'Not authorized.' };
  const result = await recommendForPlatform(auth.admin.id);
  if (!result.ok) return result;
  revalidatePath(PATH);
  const skipped = result.rejected.length ? ` ${result.rejected.length} suggestion(s) were rejected for not being grounded in the metrics.` : '';
  return { ok: true, message: `${result.created} recommendation(s) queued for approval.${skipped}` };
}

export async function decidePlatformRecommendationAction(id: string, decision: 'approve' | 'reject'): Promise<Out> {
  const auth = await requireAdmin('growth:write');
  if (!auth.ok) return { ok: false, error: 'Not authorized.' };
  const rec = await prisma.growthRecommendation.findFirst({ where: { id, scopeType: 'PLATFORM', status: 'PROPOSED' }, select: { agentActivityId: true } });
  if (!rec?.agentActivityId) return { ok: false, error: 'Recommendation not found or already decided.' };
  const scope = { type: 'PLATFORM' } as const;
  const result = decision === 'approve' ? await approveActivity(rec.agentActivityId, auth.admin.id, scope) : await rejectActivity(rec.agentActivityId, auth.admin.id, scope);
  if (decision === 'reject') await prisma.growthRecommendation.updateMany({ where: { id, status: 'PROPOSED' }, data: { status: 'REJECTED' } });
  revalidatePath(PATH);
  return result.ok ? { ok: true, message: decision === 'approve' ? 'Accepted. No automatic change was made.' : 'Rejected.' } : { ok: false, error: result.error ?? 'Could not record the decision.' };
}
