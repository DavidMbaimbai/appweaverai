import type { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { normaliseTitle, reconcileCandidate } from './reconcile';
import { sanitiseMemoryInput, type MemoryInput } from './safety';
import {
  LIMITS,
  type CodeMapRecord,
  type FeatureState,
  type MemoryEvidence,
  type MemoryRecord,
  type MemorySource,
  type MemoryStatus,
  type MemoryType,
} from './types';

type Row = Awaited<ReturnType<typeof prisma.projectMemory.findFirstOrThrow>>;

export function toMemoryRecord(row: Row): MemoryRecord {
  return {
    id: row.id,
    type: row.type as MemoryType,
    title: row.title,
    normalizedTitle: row.normalizedTitle,
    body: row.body,
    source: row.source as MemorySource,
    confidence: row.confidence,
    status: row.status as MemoryStatus,
    pinned: row.pinned,
    featureState: (row.featureState as FeatureState | null) ?? null,
    files: row.files,
    evidence: (row.evidence as MemoryEvidence | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type MemoryFilter = { status?: MemoryStatus | 'ALL'; type?: MemoryType | 'ALL'; q?: string; take?: number };

/** Every query below is scoped by projectId; callers must have authorised that project first. */
export async function listMemories(projectId: string, filter: MemoryFilter = {}): Promise<MemoryRecord[]> {
  const q = filter.q?.trim();
  const rows = await prisma.projectMemory.findMany({
    where: {
      projectId,
      ...(filter.status && filter.status !== 'ALL' ? { status: filter.status } : {}),
      ...(filter.type && filter.type !== 'ALL' ? { type: filter.type } : {}),
      ...(q
        ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { body: { contains: q, mode: 'insensitive' as const } }] }
        : {}),
    },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: Math.min(filter.take ?? 300, 500),
  });
  return rows.map(toMemoryRecord);
}

/** Rows the retrieval step ranks from: everything still relevant, plus rejected rows for dedupe. */
export async function listForReconciliation(projectId: string): Promise<MemoryRecord[]> {
  const rows = await prisma.projectMemory.findMany({
    where: { projectId, status: { in: ['ACTIVE', 'REJECTED'] } },
    orderBy: { updatedAt: 'desc' },
    take: 700,
  });
  return rows.map(toMemoryRecord);
}

export async function listActiveMemories(projectId: string): Promise<MemoryRecord[]> {
  const rows = await prisma.projectMemory.findMany({
    where: { projectId, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  return rows.map(toMemoryRecord);
}

export type WriteResult = { ok: true; id: string; supersededIds: string[] } | { ok: false; error: string; skipped?: string };

export async function createMemory(args: {
  projectId: string;
  input: MemoryInput;
  source: MemorySource;
  createdById?: string | null;
  evidence?: MemoryEvidence;
  pinned?: boolean;
}): Promise<WriteResult> {
  const clean = sanitiseMemoryInput(args.input);
  if (!clean.ok) return { ok: false, error: clean.error };
  const { value } = clean;

  const existing = await listForReconciliation(args.projectId);
  let supersedeIds: string[] = [];
  if (args.source === 'AGENT') {
    if (existing.filter((e) => e.status === 'ACTIVE').length >= LIMITS.maxActivePerProject) {
      return { ok: false, error: 'Memory is full for this project.', skipped: 'full' };
    }
    const decision = reconcileCandidate(value, existing);
    if (decision.action === 'skip') return { ok: false, error: `Skipped (${decision.reason}).`, skipped: decision.reason };
    supersedeIds = decision.supersedeIds;
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.projectMemory.create({
      data: {
        projectId: args.projectId,
        type: value.type,
        title: value.title,
        normalizedTitle: normaliseTitle(value.title),
        body: value.body,
        source: args.source,
        evidence: (args.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
        confidence: value.confidence,
        pinned: args.pinned ?? false,
        featureState: value.featureState,
        files: value.files,
        createdById: args.createdById ?? null,
      },
    });
    if (supersedeIds.length > 0) {
      await tx.projectMemory.updateMany({
        where: { projectId: args.projectId, id: { in: supersedeIds }, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', supersededById: row.id },
      });
    }
    return row;
  });
  return { ok: true, id: created.id, supersededIds: supersedeIds };
}

export async function updateMemory(projectId: string, id: string, input: MemoryInput, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = sanitiseMemoryInput(input);
  if (!clean.ok) return { ok: false, error: clean.error };
  const { value } = clean;
  const result = await prisma.projectMemory.updateMany({
    where: { id, projectId },
    data: {
      type: value.type,
      title: value.title,
      normalizedTitle: normaliseTitle(value.title),
      body: value.body,
      files: value.files,
      featureState: value.featureState,
      confidence: value.confidence,
      // A human has now vetted the entry, so the agent may no longer override it.
      source: 'USER',
      createdById: userId,
    },
  });
  return result.count === 1 ? { ok: true } : { ok: false, error: 'Memory entry not found.' };
}

export async function setPinned(projectId: string, id: string, pinned: boolean) {
  const result = await prisma.projectMemory.updateMany({ where: { id, projectId, status: 'ACTIVE' }, data: { pinned } });
  return result.count === 1;
}

export async function setStatus(projectId: string, id: string, status: Extract<MemoryStatus, 'ACTIVE' | 'REJECTED'>) {
  const result = await prisma.projectMemory.updateMany({
    where: { id, projectId },
    data: { status, supersededById: null, ...(status === 'REJECTED' ? { pinned: false } : {}) },
  });
  return result.count === 1;
}

/** Replaces an entry with a user-written one and marks the old one SUPERSEDED. */
export async function supersedeMemory(projectId: string, oldId: string, input: MemoryInput, userId: string): Promise<WriteResult> {
  const clean = sanitiseMemoryInput(input);
  if (!clean.ok) return { ok: false, error: clean.error };
  const old = await prisma.projectMemory.findFirst({ where: { id: oldId, projectId }, select: { id: true } });
  if (!old) return { ok: false, error: 'Memory entry not found.' };
  const { value } = clean;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.projectMemory.create({
      data: {
        projectId,
        type: value.type,
        title: value.title,
        normalizedTitle: normaliseTitle(value.title),
        body: value.body,
        source: 'USER',
        confidence: 1,
        featureState: value.featureState,
        files: value.files,
        createdById: userId,
      },
    });
    await tx.projectMemory.updateMany({ where: { id: oldId, projectId }, data: { status: 'SUPERSEDED', supersededById: row.id, pinned: false } });
    return row;
  });
  return { ok: true, id: created.id, supersededIds: [oldId] };
}

export async function clearAllMemories(projectId: string) {
  const [memories] = await prisma.$transaction([
    prisma.projectMemory.deleteMany({ where: { projectId } }),
    prisma.projectMemoryInjection.deleteMany({ where: { projectId } }),
  ]);
  return memories.count;
}

export async function listCodeMap(projectId: string, artifactSlug?: string, take = 500): Promise<CodeMapRecord[]> {
  const prefix = artifactSlug ? `${artifactSlug}/` : '';
  const rows = await prisma.projectCodeMapEntry.findMany({
    where: { projectId, ...(prefix ? { path: { startsWith: prefix } } : {}) },
    orderBy: { path: 'asc' },
    take,
  });
  return rows.map((r) => ({
    path: prefix ? r.path.slice(prefix.length) : r.path,
    purpose: r.purpose,
    exports: r.exports,
    routes: r.routes,
    dependencies: r.dependencies,
  }));
}

export async function recordInjection(args: {
  projectId: string;
  conversationId?: string | null;
  request: string;
  brief: string;
  memoryIds: string[];
  tokenEstimate: number;
  protectedFiles: string[];
}) {
  const row = await prisma.projectMemoryInjection.create({
    data: {
      projectId: args.projectId,
      conversationId: args.conversationId ?? null,
      request: args.request.slice(0, 2000),
      brief: args.brief,
      memoryIds: args.memoryIds,
      tokenEstimate: args.tokenEstimate,
      protectedFiles: args.protectedFiles,
    },
    select: { id: true },
  });
  const stale = await prisma.projectMemoryInjection.findMany({
    where: { projectId: args.projectId },
    orderBy: { createdAt: 'desc' },
    skip: LIMITS.injectionHistory,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.projectMemoryInjection.deleteMany({ where: { projectId: args.projectId, id: { in: stale.map((s) => s.id) } } });
  }
  return row.id;
}

export async function markUnacknowledged(projectId: string, injectionId: string, titles: string[]) {
  await prisma.projectMemoryInjection.updateMany({ where: { id: injectionId, projectId }, data: { unacknowledged: titles } });
}

export async function getLastInjection(projectId: string) {
  return prisma.projectMemoryInjection.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } });
}
