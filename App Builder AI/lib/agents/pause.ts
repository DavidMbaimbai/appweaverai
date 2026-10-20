import { prisma } from '@/lib/prisma';

import { PLATFORM_SCOPE_ID, type AgentRole } from './types';

export type KillSwitchScope = 'GLOBAL' | 'PLATFORM';

/**
 * True when the global or PLATFORM kill switch is on, or (when `agent` is given) that
 * platform agent is paused. Existing platform automations call this at the top of their
 * cron. Being disabled (the default) does NOT count as paused, so existing behaviour is
 * unchanged until an admin pauses. Fails open if the table is unreachable.
 */
export async function isAgentPaused(agent?: AgentRole): Promise<boolean> {
  try {
    const [switches, setting] = await Promise.all([
      prisma.agentKillSwitch.findMany({
        where: { scope: { in: ['GLOBAL', 'PLATFORM'] }, paused: true },
        select: { scope: true },
      }),
      agent
        ? prisma.agentSetting.findUnique({
            where: { scopeType_scopeId_agent: { scopeType: 'PLATFORM', scopeId: PLATFORM_SCOPE_ID, agent } },
            select: { paused: true },
          })
        : Promise.resolve(null),
    ]);
    return switches.length > 0 || Boolean(setting?.paused);
  } catch (error) {
    console.error('[agents] pause check failed, continuing:', error);
    return false;
  }
}

/** True only when the GLOBAL kill switch is on (used for project-scope agents). */
export async function isGloballyPaused(): Promise<boolean> {
  try {
    const row = await prisma.agentKillSwitch.findUnique({ where: { scope: 'GLOBAL' }, select: { paused: true } });
    return Boolean(row?.paused);
  } catch (error) {
    console.error('[agents] global pause check failed, continuing:', error);
    return false;
  }
}

export async function getKillSwitches() {
  const rows = await prisma.agentKillSwitch.findMany();
  const byScope = new Map(rows.map((row) => [row.scope, row]));
  return (['GLOBAL', 'PLATFORM'] as const).map((scope) => ({
    scope,
    paused: byScope.get(scope)?.paused ?? false,
    reason: byScope.get(scope)?.reason ?? null,
    updatedAt: byScope.get(scope)?.updatedAt ?? null,
  }));
}

export async function setKillSwitch(scope: KillSwitchScope, paused: boolean, updatedBy: string, reason?: string) {
  const data = { paused, reason: paused ? (reason?.slice(0, 300) ?? null) : null, updatedBy };
  await prisma.agentKillSwitch.upsert({ where: { scope }, create: { scope, ...data }, update: data });
}
