'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { checkBackupHealthAndAlert } from '@/lib/backups';
import { requireAdmin } from '@/lib/auth/require-admin';

type ActionResult = { success: true; message: string } | { error: string };

/** Re-evaluates backup health now and raises the usual alert if something is stale or failing. */
export async function checkBackupHealthAction(): Promise<ActionResult> {
  const auth = await requireAdmin('backups:write');
  if (!auth.ok) return { error: 'Not authorized.' };

  const health = await checkBackupHealthAndAlert();
  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'backups.check_health',
    targetType: 'BackupRun',
    after: { ok: health.ok, issues: health.issues, warnings: health.warnings },
  });
  revalidatePath('/admin/backups');
  const problems = [...health.issues, ...health.warnings];
  return {
    success: true,
    message: problems.length ? `Attention needed: ${problems.join(' ')}` : 'Backups and restore drills are healthy.',
  };
}
