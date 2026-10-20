'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { requestUserExport, runExportJob, signDownloadToken } from '@/lib/privacy/export';
import { cancelAccountDeletion, requestAccountDeletion } from '@/lib/privacy/user-erasure';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';

type Result = { success: true; message: string; url?: string } | { error: string };

async function currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

export async function requestDataExportAction(): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Please sign in again.' };
  const limited = await rateLimit(`privacy-export-request:${userId}`, 10, 3_600_000);
  if (!limited.ok) return { error: 'Too many requests. Try again shortly.' };
  const result = await requestUserExport(userId);
  if (!result.ok) return { error: result.error };
  if (!result.reused) after(() => runExportJob(result.jobId).catch((error) => console.error('Export job failed:', error)));
  revalidatePath('/app/privacy');
  return { success: true, message: result.reused ? 'An export is already being prepared.' : 'Preparing your export. This page updates when it is ready.' };
}

export async function createExportDownloadLinkAction(jobId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Please sign in again.' };
  const job = await prisma.privacyExportJob.findFirst({ where: { id: jobId, userId, status: 'READY' }, select: { expiresAt: true } });
  if (!job || (job.expiresAt && job.expiresAt < new Date())) return { error: 'This export is no longer available.' };
  return { success: true, message: 'Link ready (valid for 15 minutes).', url: `/api/privacy/export/download?token=${signDownloadToken(jobId)}` };
}

export async function requestAccountDeletionAction(confirmation: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Please sign in again.' };
  if (confirmation.trim() !== 'DELETE') return { error: 'Type DELETE to confirm.' };
  const result = await requestAccountDeletion(userId);
  if (!result.ok) return { error: result.error };
  revalidatePath('/app/privacy');
  return { success: true, message: `Your account will be permanently deleted on ${result.scheduledFor.toISOString().slice(0, 10)}. You can cancel until then.` };
}

export async function cancelAccountDeletionAction(): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { error: 'Please sign in again.' };
  const cancelled = await cancelAccountDeletion(userId);
  revalidatePath('/app/privacy');
  return cancelled ? { success: true, message: 'Account deletion cancelled.' } : { error: 'There is no scheduled deletion to cancel.' };
}
