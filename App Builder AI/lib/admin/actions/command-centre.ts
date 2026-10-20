'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditLog } from '@/lib/admin/audit';
import { approveActivity, pauseActivity, rejectActivity, retryActivity } from '@/lib/agents/decisions';
import { setKillSwitch } from '@/lib/agents/pause';
import { setAgentPaused } from '@/lib/agents/settings';
import { isAgentRole } from '@/lib/agents/types';
import { requireAdmin } from '@/lib/auth/require-admin';

type ActionResult = { success: true } | { error: string };

const PATH = '/admin/command-centre';

async function guard() {
  const auth = await requireAdmin('commandcentre:write');
  return auth.ok ? auth.admin : null;
}

export async function decideAgentActivityAction(
  id: string,
  decision: 'approve' | 'reject' | 'retry' | 'pause',
): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { error: 'Not authorized.' };
  const result =
    decision === 'approve'
      ? await approveActivity(id, admin.id)
      : decision === 'reject'
        ? await rejectActivity(id, admin.id)
        : decision === 'pause'
          ? await pauseActivity(id, admin.id)
          : await retryActivity(id);
  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: `agent_activity.${decision}`,
    targetType: 'AgentActivity',
    targetId: id,
    result: result.ok ? 'SUCCESS' : 'FAILURE',
    reason: result.ok ? null : result.error,
  });
  revalidatePath(PATH);
  return result.ok ? { success: true } : { error: result.error };
}

export async function setPlatformAgentStateAction(
  agent: string,
  state: 'pause' | 'resume' | 'disable',
): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { error: 'Not authorized.' };
  if (!isAgentRole(agent)) return { error: 'Unknown agent.' };
  await setAgentPaused({ type: 'PLATFORM' }, agent, state === 'pause', state === 'disable');
  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: `platform_agent.${state}`,
    targetType: 'AgentSetting',
    targetId: agent,
  });
  revalidatePath(PATH);
  return { success: true };
}

export async function setKillSwitchAction(
  scope: 'GLOBAL' | 'PLATFORM',
  paused: boolean,
  reason?: string,
): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { error: 'Not authorized.' };
  if (scope !== 'GLOBAL' && scope !== 'PLATFORM') return { error: 'Unknown scope.' };
  await setKillSwitch(scope, paused, admin.id, reason);
  await recordAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: paused ? 'agent_kill_switch.on' : 'agent_kill_switch.off',
    targetType: 'AgentKillSwitch',
    targetId: scope,
    reason: reason ?? null,
  });
  revalidatePath(PATH);
  return { success: true };
}
