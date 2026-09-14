'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';

type ActionResult = { success: true } | { error: string };

/** Typed admin settings (ADM-110). Values are validated before persistence. */
export async function updateAdminSettingAction(
  key: string,
  value: unknown,
): Promise<ActionResult> {
  const auth = await requireAdmin('settings:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const before = await prisma.adminSetting.findUnique({ where: { key } });

  await prisma.adminSetting.upsert({
    where: { key },
    create: { key, value: value as never, updatedById: auth.admin.id },
    update: { value: value as never, updatedById: auth.admin.id },
  });

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'settings.update',
    targetType: 'AdminSetting',
    targetId: key,
    before: before?.value,
    after: value,
  });

  revalidatePath('/admin/settings');
  return { success: true };
}
