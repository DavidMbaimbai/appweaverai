'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/prisma';

import {
  AI_USAGE_LIMIT_PLANS,
  getAiLimitSettingKey,
  type AiLimitPlan,
  type AiLimitSettingValue,
  validateAiLimitSetting,
} from '@/lib/admin/queries/ai-usage';

type ActionResult = { success: true } | { error: string };

async function getRequestIp() {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export async function upsertAiPlanLimitAction(
  plan: AiLimitPlan,
  value: AiLimitSettingValue,
): Promise<ActionResult> {
  const auth = await requireAdmin('ai_usage:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  if (!AI_USAGE_LIMIT_PLANS.includes(plan)) {
    return { error: 'Unsupported plan.' };
  }

  const parsed = validateAiLimitSetting(value);
  if (!parsed.ok) {
    return { error: parsed.error };
  }

  const key = getAiLimitSettingKey(plan);

  try {
    const before = await prisma.adminSetting.findUnique({ where: { key } });

    await prisma.adminSetting.upsert({
      where: { key },
      create: {
        key,
        value: parsed.value as never,
        description: `Plan-level AI usage limits for the ${plan} tier.`,
        updatedById: auth.admin.id,
      },
      update: {
        value: parsed.value as never,
        description: `Plan-level AI usage limits for the ${plan} tier.`,
        updatedById: auth.admin.id,
      },
    });

    await recordAuditLog({
      adminId: auth.admin.id,
      adminEmail: auth.admin.email,
      action: 'ai_limits.update',
      targetType: 'AdminSetting',
      targetId: key,
      before: before?.value ?? null,
      after: parsed.value,
      ipAddress: await getRequestIp(),
    });

    revalidatePath('/admin/ai-usage');
    revalidatePath('/admin/ai-usage/users');
    revalidatePath('/admin/ai-usage/projects');
    revalidatePath('/admin/ai-usage/limits');
    return { success: true };
  } catch (error) {
    console.error('Failed to save AI usage limits:', error);
    return { error: 'Failed to save AI usage limits.' };
  }
}
