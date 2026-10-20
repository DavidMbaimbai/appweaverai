'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/auth/require-admin';
import { runInboxOp, type InboxOp, type InboxOpResult } from '@/lib/messaging/ops';
import { prisma } from '@/lib/prisma';

const PATH = '/admin/inbox';

async function guard() {
  const auth = await requireAdmin('inbox:write');
  return auth.ok ? auth.admin : null;
}

export async function adminInboxOpAction(input: InboxOp): Promise<InboxOpResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: 'Not authorized.' };
  const result = await runInboxOp({ type: 'PLATFORM' }, admin.id, input);
  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: `inbox.${input.op}`,
    targetType: 'Conversation',
    targetId: input.conversationId,
    result: result.ok ? 'SUCCESS' : 'FAILURE',
    reason: result.ok ? null : result.error,
  });
  revalidatePath(PATH);
  return result;
}

export async function addPlatformKnowledgeAction(title: string, content: string): Promise<InboxOpResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: 'Not authorized.' };
  const t = typeof title === 'string' ? title.trim().slice(0, 200) : '';
  const c = typeof content === 'string' ? content.trim().slice(0, 8000) : '';
  if (!t || !c) return { ok: false, error: 'Title and content are required.' };
  const row = await prisma.platformKnowledge.create({ data: { title: t, content: c } });
  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'inbox.knowledge.add',
    targetType: 'PlatformKnowledge',
    targetId: row.id,
    result: 'SUCCESS',
    reason: null,
  });
  revalidatePath(PATH);
  return { ok: true, message: 'Knowledge entry added.' };
}

export async function deletePlatformKnowledgeAction(id: string): Promise<InboxOpResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: 'Not authorized.' };
  await prisma.platformKnowledge.deleteMany({ where: { id: String(id) } });
  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'inbox.knowledge.delete',
    targetType: 'PlatformKnowledge',
    targetId: String(id),
    result: 'SUCCESS',
    reason: null,
  });
  revalidatePath(PATH);
  return { ok: true };
}
