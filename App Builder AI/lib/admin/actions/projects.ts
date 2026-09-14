'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/prisma';

type ActionResult = { success: true } | { error: string };

const PROJECT_AUDIT_SELECT = {
  id: true,
  name: true,
  adminStatus: true,
  suspendedReason: true,
  suspendedAt: true,
  suspendedById: true,
  archivedAt: true,
} as const;

async function getRequestIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

function normalizeProjectId(projectId: string) {
  return projectId.trim();
}

function normalizeReason(reason: string) {
  return reason.trim();
}

/**
 * Suspension is currently an admin-only lifecycle flag.
 *
 * Customer-facing publish access still reads Deployment visibility/current LIVE
 * state in `lib/queries/published.ts`, and there are no runtime readers of
 * `Project.adminStatus` elsewhere yet. We intentionally do not mutate
 * deployment visibility here until product-side enforcement is implemented.
 */
export async function suspendProjectAction(
  projectId: string,
  reason: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('projects:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedReason = normalizeReason(reason);

  if (!normalizedProjectId) return { error: 'Project ID is required.' };
  if (!normalizedReason) return { error: 'A reason is required.' };

  const before = await prisma.project.findUnique({
    where: { id: normalizedProjectId },
    select: PROJECT_AUDIT_SELECT,
  });

  if (!before) return { error: 'Project not found.' };
  if (before.adminStatus === 'SUSPENDED') {
    return { error: 'Project is already suspended.' };
  }
  if (before.adminStatus === 'ARCHIVED') {
    return { error: 'Archived projects cannot be suspended.' };
  }

  try {
    await prisma.project.update({
      where: { id: normalizedProjectId },
      data: {
        adminStatus: 'SUSPENDED',
        suspendedReason: normalizedReason,
        suspendedAt: new Date(),
        suspendedById: auth.admin.id,
      },
    });
  } catch (error) {
    console.error('Failed to suspend project:', error);
    return { error: 'Failed to suspend project.' };
  }

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'project.suspend',
    targetType: 'Project',
    targetId: normalizedProjectId,
    before,
    after: {
      adminStatus: 'SUSPENDED',
      suspendedReason: normalizedReason,
      suspendedById: auth.admin.id,
    },
    reason: normalizedReason,
    ipAddress: await getRequestIp(),
  });

  revalidatePath('/admin/projects');
  revalidatePath(`/admin/projects/${normalizedProjectId}`);

  return { success: true };
}

export async function restoreProjectAction(
  projectId: string,
  reason: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('projects:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedReason = normalizeReason(reason);

  if (!normalizedProjectId) return { error: 'Project ID is required.' };
  if (!normalizedReason) return { error: 'A reason is required.' };

  const before = await prisma.project.findUnique({
    where: { id: normalizedProjectId },
    select: PROJECT_AUDIT_SELECT,
  });

  if (!before) return { error: 'Project not found.' };
  if (before.adminStatus === 'ACTIVE') {
    return { error: 'Project is already active.' };
  }

  try {
    await prisma.project.update({
      where: { id: normalizedProjectId },
      data: {
        adminStatus: 'ACTIVE',
        suspendedReason: null,
        suspendedAt: null,
        suspendedById: null,
        archivedAt: null,
      },
    });
  } catch (error) {
    console.error('Failed to restore project:', error);
    return { error: 'Failed to restore project.' };
  }

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'project.restore',
    targetType: 'Project',
    targetId: normalizedProjectId,
    before,
    after: {
      adminStatus: 'ACTIVE',
      suspendedReason: null,
      suspendedAt: null,
      suspendedById: null,
      archivedAt: null,
    },
    reason: normalizedReason,
    ipAddress: await getRequestIp(),
  });

  revalidatePath('/admin/projects');
  revalidatePath(`/admin/projects/${normalizedProjectId}`);

  return { success: true };
}

export async function archiveProjectAction(
  projectId: string,
  reason: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('projects:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedReason = normalizeReason(reason);

  if (!normalizedProjectId) return { error: 'Project ID is required.' };
  if (!normalizedReason) return { error: 'A reason is required.' };

  const before = await prisma.project.findUnique({
    where: { id: normalizedProjectId },
    select: PROJECT_AUDIT_SELECT,
  });

  if (!before) return { error: 'Project not found.' };
  if (before.adminStatus === 'ARCHIVED') {
    return { error: 'Project is already archived.' };
  }

  const archivedAt = new Date();

  try {
    await prisma.project.update({
      where: { id: normalizedProjectId },
      data: {
        adminStatus: 'ARCHIVED',
        archivedAt,
      },
    });
  } catch (error) {
    console.error('Failed to archive project:', error);
    return { error: 'Failed to archive project.' };
  }

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'project.archive',
    targetType: 'Project',
    targetId: normalizedProjectId,
    before,
    after: {
      adminStatus: 'ARCHIVED',
      archivedAt,
    },
    reason: normalizedReason,
    ipAddress: await getRequestIp(),
  });

  revalidatePath('/admin/projects');
  revalidatePath(`/admin/projects/${normalizedProjectId}`);

  return { success: true };
}
