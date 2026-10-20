'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/require-admin';
import { dismissReport, moderateVersion, takedownAsset } from '@/lib/marketplace/moderate';
import { seedFirstPartyAssets } from '@/lib/marketplace/seed';

type ActionResult = { success: true; message: string } | { error: string };

function refresh() {
  revalidatePath('/admin/marketplace');
  revalidatePath('/marketplace', 'layout');
}

async function admin() {
  const auth = await requireAdmin('marketplace:write');
  return auth.ok ? auth.admin : null;
}

export async function adminModerateVersionAction(versionId: string, action: 'approve' | 'reject' | 'remove' | 'restore', reason: string): Promise<ActionResult> {
  const actor = await admin();
  if (!actor) return { error: 'Not authorized.' };
  if (!['approve', 'reject', 'remove', 'restore'].includes(action) || typeof versionId !== 'string') return { error: 'Invalid request.' };
  const result = await moderateVersion({ actor: { id: actor.id, email: actor.email }, action, versionId, reason: String(reason ?? '') });
  if (!result.ok) return { error: result.error };
  refresh();
  return { success: true, message: `Done: ${action}.` };
}

export async function adminTakedownAssetAction(assetId: string, reason: string): Promise<ActionResult> {
  const actor = await admin();
  if (!actor) return { error: 'Not authorized.' };
  const result = await takedownAsset({ actor: { id: actor.id, email: actor.email }, assetId: String(assetId ?? ''), reason: String(reason ?? '') });
  if (!result.ok) return { error: result.error };
  refresh();
  return { success: true, message: 'Asset taken down.' };
}

export async function adminDismissReportAction(reportId: string): Promise<ActionResult> {
  const actor = await admin();
  if (!actor) return { error: 'Not authorized.' };
  const result = await dismissReport({ actor: { id: actor.id, email: actor.email }, reportId: String(reportId ?? '') });
  if (!result.ok) return { error: result.error };
  refresh();
  return { success: true, message: 'Report dismissed.' };
}

export async function adminSeedFirstPartyAction(): Promise<ActionResult> {
  const actor = await admin();
  if (!actor) return { error: 'Not authorized.' };
  const report = await seedFirstPartyAssets({ id: actor.id, email: actor.email });
  refresh();
  const failed = report.failed.length > 0 ? ` Failed: ${report.failed.map((f) => f.slug).join(', ')}.` : '';
  return { success: true, message: `Created ${report.created.length}, updated ${report.updated.length}, unchanged ${report.unchanged.length}.${failed}` };
}
