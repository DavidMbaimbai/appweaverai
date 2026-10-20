'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { setCatalogueDisabled } from '@/lib/integrations/admin';
import { getIntegration } from '@/lib/integrations/catalogue';

type ActionResult = { success: true; message: string } | { error: string };

/** Kill-switch for a catalogue entry: blocks new connections and proxy calls while disabled. */
export async function adminSetIntegrationDisabledAction(
  integrationId: string,
  disabled: boolean,
  reason: string,
): Promise<ActionResult> {
  const auth = await requireAdmin('integrations:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  const def = typeof integrationId === 'string' ? getIntegration(integrationId) : undefined;
  if (!def) return { error: 'Unknown integration.' };
  const cleanReason = String(reason ?? '').trim().slice(0, 200);
  if (disabled && cleanReason.length < 3) return { error: 'Give a short reason (shown to customers).' };

  await setCatalogueDisabled({ integrationId: def.id, disabled: Boolean(disabled), reason: disabled ? cleanReason : null, adminId: auth.admin.id });
  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: disabled ? 'integration.disable' : 'integration.enable',
    targetType: 'Integration',
    targetId: def.id,
    reason: disabled ? cleanReason : null,
  });
  revalidatePath('/admin/integrations');
  return { success: true, message: `${def.name} ${disabled ? 'disabled' : 'enabled'}.` };
}
