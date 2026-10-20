'use server';

import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/require-user';
import { estimateOperation, type CreditEstimate } from '@/lib/credits/estimate';
import { markAlertsRead, setSpendLimit } from '@/lib/credits/limits';
import { CREDIT_OPERATION_LABELS, type CreditOperation } from '@/lib/credits/pricing';
import { prisma } from '@/lib/prisma';

type Result = { success: true } | { error: string };

function parseLimit(value: number | null): number | null | 'invalid' {
  if (value === null) return null;
  return Number.isInteger(value) && value >= 1 && value <= 10_000_000 ? value : 'invalid';
}

export async function setSpendLimitAction(input: { scope: 'USER' | 'WORKSPACE'; workspaceId?: string; monthlyLimit: number | null }): Promise<Result> {
  const { userId, error } = await requireUserId();
  if (!userId) return { error: error ?? 'Unauthorized' };
  const limit = parseLimit(input.monthlyLimit);
  if (limit === 'invalid') return { error: 'Enter a whole number of credits, or leave blank to remove the limit.' };

  if (input.scope === 'WORKSPACE') {
    if (!input.workspaceId) return { error: 'Choose a workspace.' };
    const workspace = await prisma.workspace.findFirst({ where: { id: input.workspaceId, ownerId: userId }, select: { id: true } });
    if (!workspace) return { error: 'Only the workspace owner can set its limit.' };
    await setSpendLimit('WORKSPACE', workspace.id, limit, userId);
  } else {
    await setSpendLimit('USER', userId, limit, userId);
  }
  revalidatePath('/app/usage');
  return { success: true };
}

export async function markUsageAlertsReadAction(): Promise<Result> {
  const { userId, error } = await requireUserId();
  if (!userId) return { error: error ?? 'Unauthorized' };
  await markAlertsRead(userId);
  revalidatePath('/app/usage');
  return { success: true };
}

export async function estimateCreditsAction(
  operation: CreditOperation,
  options: { seconds?: number; workspaceId?: string | null } = {},
): Promise<CreditEstimate | null> {
  const { userId } = await requireUserId();
  if (!userId || !(operation in CREDIT_OPERATION_LABELS)) return null;
  const seconds = typeof options.seconds === 'number' && options.seconds > 0 ? Math.min(options.seconds, 3600) : undefined;
  let workspaceId: string | null = null;
  if (options.workspaceId) {
    const member = await prisma.workspace.findFirst({ where: { id: options.workspaceId, ownerId: userId }, select: { id: true } });
    workspaceId = member?.id ?? null;
  }
  return estimateOperation(userId, operation, { params: { seconds }, workspaceId });
}
