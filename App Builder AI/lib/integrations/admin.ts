import { prisma } from '@/lib/prisma';

import { INTEGRATIONS } from './catalogue';

export type AdminIntegrationRow = {
  id: string;
  name: string;
  category: string;
  status: string;
  connected: number;
  healthy: number;
  degraded: number;
  down: number;
  unknown: number;
  usageCount: number;
  failures7d: number;
  checks7d: number;
  disabled: boolean;
  disabledReason: string | null;
};

/** Cross-tenant overview. Selects no secret, config or credential columns. */
export async function getAdminIntegrationOverview() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [connections, checks, overrides, recentFailures, webhooks] = await Promise.all([
    prisma.integrationConnection.groupBy({
      by: ['integrationId', 'healthStatus'],
      _count: { _all: true },
      _sum: { usageCount: true },
    }),
    prisma.integrationHealthCheck.groupBy({
      by: ['integrationId', 'ok'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.integrationCatalogueOverride.findMany(),
    prisma.integrationHealthCheck.findMany({
      where: { ok: false, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        integrationId: true,
        error: true,
        latencyMs: true,
        createdAt: true,
        connection: { select: { project: { select: { name: true, slug: true, workspace: { select: { slug: true } } } } } },
      },
    }),
    prisma.webhookDelivery.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);

  const overrideMap = new Map(overrides.map((o) => [o.integrationId, o]));
  const rows: AdminIntegrationRow[] = INTEGRATIONS.map((def) => {
    const mine = connections.filter((c) => c.integrationId === def.id);
    const count = (status: string) => mine.find((c) => c.healthStatus === status)?._count._all ?? 0;
    const myChecks = checks.filter((c) => c.integrationId === def.id);
    const override = overrideMap.get(def.id);
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      status: def.status,
      connected: mine.reduce((sum, c) => sum + c._count._all, 0),
      healthy: count('HEALTHY'),
      degraded: count('DEGRADED'),
      down: count('DOWN'),
      unknown: count('UNKNOWN'),
      usageCount: mine.reduce((sum, c) => sum + (c._sum.usageCount ?? 0), 0),
      failures7d: myChecks.filter((c) => !c.ok).reduce((sum, c) => sum + c._count._all, 0),
      checks7d: myChecks.reduce((sum, c) => sum + c._count._all, 0),
      disabled: override?.disabled ?? false,
      disabledReason: override?.disabled ? override.reason : null,
    };
  });

  return {
    rows,
    recentFailures: recentFailures.map((f) => ({
      id: f.id,
      integrationId: f.integrationId,
      error: f.error,
      latencyMs: f.latencyMs,
      createdAt: f.createdAt,
      project: `${f.connection.project.workspace.slug}/${f.connection.project.slug}`,
      projectName: f.connection.project.name,
    })),
    webhooks: Object.fromEntries(webhooks.map((w) => [w.status, w._count._all])) as Record<string, number>,
  };
}

export async function setCatalogueDisabled(input: { integrationId: string; disabled: boolean; reason: string | null; adminId: string }) {
  await prisma.integrationCatalogueOverride.upsert({
    where: { integrationId: input.integrationId },
    create: { integrationId: input.integrationId, disabled: input.disabled, reason: input.reason, updatedById: input.adminId },
    update: { disabled: input.disabled, reason: input.reason, updatedById: input.adminId },
  });
}
