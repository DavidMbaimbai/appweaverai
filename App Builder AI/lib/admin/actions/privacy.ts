'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { listSubjectConsents, withdrawConsent, type ConsentEntry } from '@/lib/privacy/consents';
import {
  completeRequest,
  eraseForRequest,
  exportForRequest,
  searchForRequest,
  type RequestOutcome,
} from '@/lib/privacy/requests';
import { runRetention, savePolicy, type RetentionKey, type RetentionRunEntry } from '@/lib/privacy/retention';
import { findSubject, summariseMatches, totalMatches } from '@/lib/privacy/subject';

type Err = { error: string };

export async function searchSubjectAction(requestId: string | null, query: { email?: string; phone?: string }): Promise<{ summary: Record<string, number>; total: number; consents: ConsentEntry[] } | Err> {
  const auth = await requireAdmin('privacy:read');
  if (!auth.ok) return { error: 'Not authorized.' };
  try {
    const actor = { id: auth.admin.id, email: auth.admin.email };
    const matches = requestId ? (await searchForRequest(requestId, actor, query.email || query.phone ? query : undefined)).matches : await findSubject(query);
    if (!requestId) {
      await recordAuditLog({ adminId: actor.id, adminEmail: actor.email, action: 'privacy.search', targetType: 'PrivacySubject', after: { found: totalMatches(matches) } });
    }
    return { summary: summariseMatches(matches), total: totalMatches(matches), consents: await listSubjectConsents(matches) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Search failed.' };
  }
}

export async function exportSubjectAction(requestId: string): Promise<{ json: string } | Err> {
  const auth = await requireAdmin('privacy:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  try {
    const data = await exportForRequest(requestId, { id: auth.admin.id, email: auth.admin.email });
    revalidatePath('/admin/privacy');
    return { json: JSON.stringify(data, null, 2) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Export failed.' };
  }
}

export async function eraseSubjectAction(requestId: string, confirmation: string): Promise<{ message: string } | Err> {
  const auth = await requireAdmin('privacy:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  if (confirmation.trim() !== 'ERASE') return { error: 'Type ERASE to confirm.' };
  try {
    const { found } = await eraseForRequest(requestId, { id: auth.admin.id, email: auth.admin.email }, { suppressFuture: true });
    revalidatePath('/admin/privacy');
    return { message: `Erased or anonymised ${found} record(s). A hashed opt-out was kept so the person is not contacted again.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Erasure failed.' };
  }
}

export async function completeRequestAction(requestId: string, outcome: string, note: string): Promise<{ message: string } | Err> {
  const auth = await requireAdmin('privacy:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  const result = await completeRequest(requestId, { id: auth.admin.id, email: auth.admin.email }, outcome as RequestOutcome, note);
  if (!result.ok) return { error: result.error };
  revalidatePath('/admin/privacy');
  return { message: 'Request closed.' };
}

export async function withdrawConsentAction(key: string): Promise<{ message: string } | Err> {
  const auth = await requireAdmin('privacy:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  const result = await withdrawConsent(key);
  await recordAuditLog({ adminId: auth.admin.id, adminEmail: auth.admin.email, action: 'privacy.consent.withdraw', targetType: 'Consent', targetId: key, result: result.ok ? 'SUCCESS' : 'FAILURE' });
  revalidatePath('/admin/privacy');
  return result.ok ? { message: result.message } : { error: result.message };
}

export async function savePolicyAction(key: string, retentionDays: number, enabled: boolean, dryRun: boolean): Promise<{ message: string } | Err> {
  const auth = await requireAdmin('privacy:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  const result = await savePolicy(key, { retentionDays, enabled, dryRun }, auth.admin.id);
  if (!result.ok) return { error: result.error };
  await recordAuditLog({ adminId: auth.admin.id, adminEmail: auth.admin.email, action: 'privacy.retention.update', targetType: 'RetentionPolicy', targetId: key, after: { retentionDays, enabled, dryRun } });
  revalidatePath('/admin/privacy');
  return { message: 'Policy saved.' };
}

export async function runRetentionNowAction(key: string, dryRun: boolean): Promise<{ results: RetentionRunEntry[] } | Err> {
  const auth = await requireAdmin('privacy:write');
  if (!auth.ok) return { error: 'Not authorized.' };
  const results = await runRetention({ only: key as RetentionKey, dryRun, actor: { id: auth.admin.id, email: auth.admin.email } });
  revalidatePath('/admin/privacy');
  return { results };
}
