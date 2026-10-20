'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { reverseDevEntry, reverseMarketingEntry } from '@/lib/credits/reversal';

type Result = { success: true; credits: number; balanceAfter: number } | { error: string };

export async function reverseLedgerEntryAction(input: {
  ledger: 'DEV' | 'MARKETING';
  entryId: string;
  reason: string;
}): Promise<Result> {
  const auth = await requireAdmin('payments:refund');
  if (!auth.ok) return { error: 'Not authorized.' };
  const reason = input.reason?.trim();
  if (!reason) return { error: 'A reason is required.' };
  if (input.ledger !== 'DEV' && input.ledger !== 'MARKETING') return { error: 'Unknown ledger.' };

  const args = { entryId: input.entryId, adminId: auth.admin.id, reason };
  const result = input.ledger === 'DEV' ? await reverseDevEntry(args) : await reverseMarketingEntry(args);
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  await recordAuditLog({
    adminId: auth.admin.id,
    adminEmail: auth.admin.email,
    action: 'credits.reverse',
    targetType: `${input.ledger}Ledger`,
    targetId: input.entryId,
    after: result.ok ? { credits: result.credits, balanceAfter: result.balanceAfter } : { code: result.code },
    result: result.ok ? 'SUCCESS' : 'FAILURE',
    reason,
    ipAddress: ip,
  });

  if (!result.ok) return { error: result.message };
  revalidatePath('/admin/revenue');
  return { success: true, credits: result.credits, balanceAfter: result.balanceAfter };
}
