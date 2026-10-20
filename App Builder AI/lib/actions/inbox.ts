'use server';

import { revalidatePath } from 'next/cache';

import { getCachedSession } from '../auth/cached';
import { verifyChannel } from '../messaging/availability';
import { removeProjectConnection, saveProjectConnection } from '../messaging/connections';
import { runInboxOp, type InboxOp, type InboxOpResult } from '../messaging/ops';
import { isMessageChannel } from '../messaging/types';
import { prisma } from '../prisma';
import { projectAccessWhere } from '../projects/access';
import { rateLimit } from '../rate-limit';

async function authorize(projectId: string) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || typeof projectId !== 'string') return null;
  const project = await prisma.project.findFirst({ where: { id: projectId, ...projectAccessWhere(userId) }, select: { id: true } });
  return project ? userId : null;
}

export async function inboxOpAction(projectId: string, input: InboxOp): Promise<InboxOpResult> {
  const userId = await authorize(projectId);
  if (!userId) return { ok: false, error: 'Unauthorized' };
  if (!(await rateLimit(`inbox-op:${userId}`, 60, 60_000)).ok) return { ok: false, error: 'Too many actions. Slow down.' };
  const result = await runInboxOp({ type: 'PROJECT', projectId }, userId, input);
  revalidatePath('/app/projects');
  return result;
}

export async function saveChannelConnectionAction(
  projectId: string,
  channel: string,
  fields: Record<string, string>,
): Promise<InboxOpResult> {
  const userId = await authorize(projectId);
  if (!userId) return { ok: false, error: 'Unauthorized' };
  if (!isMessageChannel(channel)) return { ok: false, error: 'Unknown channel.' };
  try {
    await saveProjectConnection(projectId, channel, fields ?? {});
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save.' };
  }
  revalidatePath('/app/projects');
  return { ok: true, message: 'Connection saved (encrypted).' };
}

export async function verifyChannelAction(projectId: string, channel: string): Promise<InboxOpResult> {
  const userId = await authorize(projectId);
  if (!userId) return { ok: false, error: 'Unauthorized' };
  if (!isMessageChannel(channel)) return { ok: false, error: 'Unknown channel.' };
  if (!(await rateLimit(`inbox-verify:${userId}`, 10, 60_000)).ok) return { ok: false, error: 'Too many checks. Slow down.' };
  const r = await verifyChannel({ type: 'PROJECT', projectId }, channel);
  revalidatePath('/app/projects');
  return r.status === 'AVAILABLE' ? { ok: true, message: r.detail } : { ok: false, error: r.detail };
}

export async function removeChannelConnectionAction(projectId: string, channel: string): Promise<InboxOpResult> {
  const userId = await authorize(projectId);
  if (!userId) return { ok: false, error: 'Unauthorized' };
  if (!isMessageChannel(channel)) return { ok: false, error: 'Unknown channel.' };
  await removeProjectConnection(projectId, channel);
  revalidatePath('/app/projects');
  return { ok: true, message: 'Connection removed.' };
}
