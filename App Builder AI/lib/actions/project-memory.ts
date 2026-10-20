'use server';

import { revalidatePath } from 'next/cache';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { getCachedSession } from '@/lib/auth/cached';
import { rateLimit } from '@/lib/rate-limit';
import { getMemoryAccess, type MemoryAccess } from '@/lib/project-memory/access';
import { refreshCodeMap } from '@/lib/project-memory/code-map';
import { memoryToMarkdown } from '@/lib/project-memory/export';
import type { MemoryInput } from '@/lib/project-memory/safety';
import {
  clearAllMemories,
  createMemory,
  listMemories,
  setPinned,
  setStatus,
  supersedeMemory,
  updateMemory,
} from '@/lib/project-memory/store';
import { prisma } from '@/lib/prisma';

type Fail = { error: string };

async function authorize(projectId: string, write: boolean): Promise<Fail | MemoryAccess> {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return { error: 'You must be signed in.' };
  const access = await getMemoryAccess(projectId, userId);
  if (!access) return { error: 'Project not found.' };
  if (write && !access.canWrite) return { error: 'You need editor access to change project memory.' };
  return access;
}

async function throttled(userId: string) {
  const limit = await rateLimit(`project-memory:${userId}`, 60, 60_000);
  return limit.ok ? null : { error: 'Too many changes. Please wait a minute.' };
}

function done(access: MemoryAccess) {
  revalidatePath(`/app/projects/${access.workspaceSlug}/${access.projectSlug}/memory`);
}

async function audit(access: MemoryAccess, action: string, targetId: string | null, detail?: unknown) {
  await recordUserActivity({
    userId: access.userId,
    action: `project_memory.${action}`,
    targetType: 'ProjectMemory',
    targetId: targetId ?? access.projectId,
    after: { projectId: access.projectId, ...(detail ? { detail } : {}) },
  });
}

export async function createMemoryAction(projectId: string, input: MemoryInput): Promise<Fail | { ok: true; id: string }> {
  const access = await authorize(projectId, true);
  if ('error' in access) return access;
  const limited = await throttled(access.userId);
  if (limited) return limited;
  const result = await createMemory({ projectId, input, source: 'USER', createdById: access.userId });
  if (!result.ok) return { error: result.error };
  await audit(access, 'create', result.id, { title: input.title, type: input.type });
  done(access);
  return { ok: true, id: result.id };
}

export async function updateMemoryAction(projectId: string, id: string, input: MemoryInput): Promise<Fail | { ok: true }> {
  const access = await authorize(projectId, true);
  if ('error' in access) return access;
  const result = await updateMemory(projectId, id, input, access.userId);
  if (!result.ok) return { error: result.error };
  await audit(access, 'update', id, { title: input.title });
  done(access);
  return { ok: true };
}

export async function pinMemoryAction(projectId: string, id: string, pinned: boolean): Promise<Fail | { ok: true }> {
  const access = await authorize(projectId, true);
  if ('error' in access) return access;
  if (!(await setPinned(projectId, id, pinned))) return { error: 'Only active entries can be pinned.' };
  await audit(access, pinned ? 'pin' : 'unpin', id);
  done(access);
  return { ok: true };
}

export async function rejectMemoryAction(projectId: string, id: string): Promise<Fail | { ok: true }> {
  const access = await authorize(projectId, true);
  if ('error' in access) return access;
  if (!(await setStatus(projectId, id, 'REJECTED'))) return { error: 'Memory entry not found.' };
  await audit(access, 'reject', id);
  done(access);
  return { ok: true };
}

export async function restoreMemoryAction(projectId: string, id: string): Promise<Fail | { ok: true }> {
  const access = await authorize(projectId, true);
  if ('error' in access) return access;
  if (!(await setStatus(projectId, id, 'ACTIVE'))) return { error: 'Memory entry not found.' };
  await audit(access, 'restore', id);
  done(access);
  return { ok: true };
}

export async function supersedeMemoryAction(projectId: string, id: string, input: MemoryInput): Promise<Fail | { ok: true; id: string }> {
  const access = await authorize(projectId, true);
  if ('error' in access) return access;
  const result = await supersedeMemory(projectId, id, input, access.userId);
  if (!result.ok) return { error: result.error };
  await audit(access, 'supersede', id, { replacedBy: result.id });
  done(access);
  return { ok: true, id: result.id };
}

export async function clearAllMemoryAction(projectId: string, confirmation: string): Promise<Fail | { ok: true; deleted: number }> {
  const access = await authorize(projectId, true);
  if ('error' in access) return access;
  if (confirmation.trim() !== 'CLEAR') return { error: 'Type CLEAR to confirm.' };
  const deleted = await clearAllMemories(projectId);
  await audit(access, 'clear_all', null, { deleted });
  done(access);
  return { ok: true, deleted };
}

export async function exportMemoryMarkdownAction(projectId: string): Promise<Fail | { ok: true; filename: string; markdown: string }> {
  const access = await authorize(projectId, false);
  if ('error' in access) return access;
  const memories = await listMemories(projectId, { status: 'ALL', take: 500 });
  await audit(access, 'export', null, { count: memories.length });
  return { ok: true, filename: `${access.projectSlug}-memory.md`, markdown: memoryToMarkdown(access.projectName, memories) };
}

export async function refreshCodeMapAction(projectId: string): Promise<Fail | { ok: true; changed: number }> {
  const access = await authorize(projectId, true);
  if ('error' in access) return access;
  const artifacts = await prisma.artifact.findMany({ where: { projectId }, select: { slug: true } });
  let changed = 0;
  for (const artifact of artifacts) {
    const refresh = await refreshCodeMap(projectId, artifact.slug);
    changed += refresh.changed.length + refresh.removed.length;
  }
  await audit(access, 'refresh_code_map', null, { changed });
  done(access);
  return { ok: true, changed };
}
