'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/prisma';
import { getVideoProvider } from '@/lib/video/providers/registry';

type ActionResult = { success: true } | { error: string };

const schema = z.object({
  enabled: z.boolean(),
  maxSecondsPerJob: z.number().int().min(6).max(600),
  dailyJobLimit: z.number().int().min(0).max(100_000),
  monthlyBudgetCents: z.number().int().min(0).max(100_000_000),
  models: z.array(z.string().trim().min(1).max(120)).max(10),
});

export type VideoProviderConfigInput = z.infer<typeof schema>;

export async function updateVideoProviderConfigAction(
  providerId: string,
  input: VideoProviderConfigInput,
): Promise<ActionResult> {
  const auth = await requireAdmin('video:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  const provider = getVideoProvider(providerId);
  if (!provider) return { error: 'Unknown provider.' };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: 'Check the limits: they must be whole, non-negative numbers.' };

  const data = parsed.data;
  const models = data.models.length > 0 ? data.models : [provider.defaultModel];
  const before = await prisma.videoProviderConfig.findUnique({ where: { providerId } });
  await prisma.videoProviderConfig.upsert({
    where: { providerId },
    create: { providerId, ...data, models },
    update: { ...data, models },
  });

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'video_provider.update',
    targetType: 'VideoProviderConfig',
    targetId: providerId,
    before: before
      ? {
          enabled: before.enabled,
          maxSecondsPerJob: before.maxSecondsPerJob,
          dailyJobLimit: before.dailyJobLimit,
          monthlyBudgetCents: before.monthlyBudgetCents,
        }
      : null,
    after: { ...data, models },
  });
  revalidatePath('/admin/video');
  return { success: true };
}
