'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { prisma } from '@/lib/prisma';
import { recordAuditLog } from '@/lib/admin/audit';
import { recordSecurityEvent } from '@/lib/admin/security-events';
import { requireAdmin } from '@/lib/auth/require-admin';
import type { AdminRole } from '@/lib/generated/prisma/client';

async function getRequestIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

type ActionResult = { success: true } | { error: string };

export async function suspendUserAction(
  userId: string,
  reason: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('users:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  if (!reason.trim()) return { error: 'A reason is required.' };

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true },
  });
  if (!before) return { error: 'User not found.' };

  await prisma.user.update({
    where: { id: userId },
    data: {
      accountStatus: 'SUSPENDED',
      statusReason: reason,
      statusChangedAt: new Date(),
      statusChangedById: auth.admin.id,
    },
  });

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'user.suspend',
    targetType: 'User',
    targetId: userId,
    before,
    after: { accountStatus: 'SUSPENDED' },
    reason,
    ipAddress: await getRequestIp(),
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/admin/users');
  return { success: true };
}

export async function reactivateUserAction(
  userId: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('users:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true },
  });
  if (!before) return { error: 'User not found.' };

  await prisma.user.update({
    where: { id: userId },
    data: {
      accountStatus: 'ACTIVE',
      statusReason: null,
      statusChangedAt: new Date(),
      statusChangedById: auth.admin.id,
      bannedAt: null,
      banExpiresAt: null,
    },
  });

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'user.reactivate',
    targetType: 'User',
    targetId: userId,
    before,
    after: { accountStatus: 'ACTIVE' },
    ipAddress: await getRequestIp(),
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/admin/users');
  return { success: true };
}

export async function disableUserAction(
  userId: string,
  reason: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('users:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  if (!reason.trim()) return { error: 'A reason is required.' };

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true },
  });
  if (!before) return { error: 'User not found.' };

  await prisma.user.update({
    where: { id: userId },
    data: {
      accountStatus: 'DISABLED',
      statusReason: reason,
      statusChangedAt: new Date(),
      statusChangedById: auth.admin.id,
    },
  });

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'user.disable',
    targetType: 'User',
    targetId: userId,
    before,
    after: { accountStatus: 'DISABLED' },
    reason,
    ipAddress: await getRequestIp(),
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/admin/users');
  return { success: true };
}

export async function banUserAction(
  userId: string,
  reason: string,
  expiresAt?: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('users:ban');
  if (!auth.ok) return { error: 'Not authorized.' };
  if (!reason.trim()) return { error: 'A reason is required.' };

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true },
  });
  if (!before) return { error: 'User not found.' };

  const banExpiresAt = expiresAt ? new Date(expiresAt) : null;
  if (expiresAt && Number.isNaN(banExpiresAt?.getTime())) {
    return { error: 'Invalid expiry date.' };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'BANNED',
        statusReason: reason,
        statusChangedAt: new Date(),
        statusChangedById: auth.admin.id,
        bannedAt: new Date(),
        banExpiresAt,
      },
    }),
    // Invalidate all active sessions immediately.
    prisma.session.deleteMany({ where: { userId } }),
  ]);

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'user.ban',
    targetType: 'User',
    targetId: userId,
    before,
    after: { accountStatus: 'BANNED', banExpiresAt },
    reason,
    ipAddress: await getRequestIp(),
  });

  await recordSecurityEvent({
    type: 'ACCOUNT_BANNED',
    severity: 'HIGH',
    subjectType: 'User',
    subjectId: userId,
    message: `User banned by ${auth.admin.email ?? auth.admin.id}: ${reason}`,
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/admin/users');
  return { success: true };
}

export async function setUserRoleAction(
  userId: string,
  role: AdminRole | null,
): Promise<ActionResult> {
  const auth = await requireAdmin('users:roles');
  if (!auth.ok) return { error: 'Only Super Admins can change admin roles.' };

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { adminRole: true },
  });
  if (!before) return { error: 'User not found.' };

  await prisma.user.update({
    where: { id: userId },
    data: { adminRole: role },
  });

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'user.set_admin_role',
    targetType: 'User',
    targetId: userId,
    before,
    after: { adminRole: role },
    ipAddress: await getRequestIp(),
  });

  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

export async function adjustCreditsAction(
  userId: string,
  amount: number,
  reason: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('users:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  if (!reason.trim()) return { error: 'A reason is required.' };
  if (!Number.isFinite(amount) || amount === 0) {
    return { error: 'Enter a non-zero adjustment amount.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true },
  });
  if (!user) return { error: 'User not found.' };

  const nextBalance = user.creditBalance + amount;
  if (nextBalance < 0) {
    return { error: 'Adjustment would result in a negative balance.' };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: nextBalance },
    }),
    prisma.creditAdjustment.create({
      data: { userId, amount, reason, adminId: auth.admin.id },
    }),
  ]);

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'user.adjust_credits',
    targetType: 'User',
    targetId: userId,
    before: { creditBalance: user.creditBalance },
    after: { creditBalance: nextBalance },
    reason,
    ipAddress: await getRequestIp(),
  });

  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}
