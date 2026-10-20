import { describe, expect, it, vi } from 'vitest';

import { makeProjectFor, makeUser, prisma } from '@/tests/integration/db';

const session = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/auth/cached', () => ({
  getCachedSession: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)),
}));

import {
  clearAllMemoryAction,
  createMemoryAction,
  exportMemoryMarkdownAction,
  pinMemoryAction,
} from '@/lib/actions/project-memory';
import { getMemoryAccess } from './access';
import { createMemory, listMemories } from './store';

async function tenant() {
  const user = await makeUser();
  const { project } = await makeProjectFor(user);
  return { user, project };
}

describe('project memory tenant isolation', () => {
  it('scopes store reads and supersedes to one project', async () => {
    const a = await tenant();
    const b = await tenant();
    const input = { type: 'DECISION', title: 'Use Stripe for payments', body: 'Payments go through Stripe checkout.' };
    const first = await createMemory({ projectId: a.project.id, input, source: 'AGENT', createdById: a.user.id });
    await createMemory({ projectId: b.project.id, input: { ...input, body: 'Tenant B uses Paddle instead.' }, source: 'AGENT', createdById: b.user.id });
    expect(first.ok).toBe(true);
    const aList = await listMemories(a.project.id, { status: 'ALL' });
    const bList = await listMemories(b.project.id, { status: 'ALL' });
    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(1);
    expect(bList[0].body).toContain('Paddle');
  });

  it('refuses cross-tenant access and viewer writes', async () => {
    const a = await tenant();
    const b = await tenant();
    expect(await getMemoryAccess(a.project.id, b.user.id)).toBeNull();

    session.userId = b.user.id;
    const denied = await createMemoryAction(a.project.id, { type: 'DECISION', title: 'Intruder note', body: 'Should never land.' });
    expect('error' in denied).toBe(true);
    expect('error' in (await exportMemoryMarkdownAction(a.project.id))).toBe(true);
    expect('error' in (await clearAllMemoryAction(a.project.id, 'CLEAR'))).toBe(true);
    expect(await listMemories(a.project.id, { status: 'ALL' })).toHaveLength(0);

    session.userId = a.user.id;
    const ok = await createMemoryAction(a.project.id, { type: 'DECISION', title: 'Owner note', body: 'Owner can write.' });
    expect('ok' in ok).toBe(true);
    if ('id' in ok) {
      session.userId = b.user.id;
      expect('error' in (await pinMemoryAction(a.project.id, ok.id, true))).toBe(true);
    }
    session.userId = null;
  });

  it('rejects secrets and cascades on project delete', async () => {
    const a = await tenant();
    session.userId = a.user.id;
    const bad = await createMemoryAction(a.project.id, { type: 'INTEGRATION', title: 'Stripe key', body: 'sk-abcdefghijklmnopqrstuvwx123456' });
    expect('error' in bad).toBe(true);
    await createMemoryAction(a.project.id, { type: 'DECISION', title: 'Keep this', body: 'Some decision.' });
    await prisma.projectCodeMapEntry.create({
      data: { projectId: a.project.id, path: 'app/a.ts', contentHash: 'h', purpose: 'p', exports: [], routes: [], dependencies: [] },
    });
    await prisma.project.delete({ where: { id: a.project.id } });
    expect(await prisma.projectMemory.count({ where: { projectId: a.project.id } })).toBe(0);
    expect(await prisma.projectCodeMapEntry.count({ where: { projectId: a.project.id } })).toBe(0);
    session.userId = null;
  });
});
