'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { runCodeScan } from '@/lib/code-scan/service';

type ActionResult = { success: true; message: string } | { error: string };

/** Re-scans a project's working files on behalf of an admin. Read-only for the project itself. */
export async function adminRescanProjectAction(projectId: string): Promise<ActionResult> {
  const auth = await requireAdmin('codescan:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  if (!projectId || typeof projectId !== 'string') return { error: 'Project is required.' };

  try {
    const scan = await runCodeScan({ projectId, userId: null, trigger: 'ADMIN', source: 'WORKING' });
    await recordAuditLog({
      adminId: auth.admin.id,
      adminEmail: auth.admin.email,
      action: 'code_scan.admin_rescan',
      targetType: 'Project',
      targetId: projectId,
      after: { runId: scan.id, counts: scan.counts, depStatus: scan.depStatus },
    });
    revalidatePath('/admin/code-scan');
    const { critical, high } = scan.counts;
    return { success: true, message: `Scanned ${scan.filesScanned} files: ${critical} critical, ${high} high.` };
  } catch {
    return { error: 'The scan could not be completed.' };
  }
}
