import { randomBytes } from 'node:crypto';

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';
import {
  deleteEnvVar,
  ENV_ENVIRONMENTS,
  MANAGED_ENV_KEYS,
  upsertEnvVar,
} from '@/lib/projects/env-vars';

import {
  getIntegration,
  INTEGRATIONS,
  maskLast4,
  toPublicIntegration,
  validateCredentials,
  type IntegrationDefinition,
  type PublicIntegration,
} from './catalogue';
import { publicSecretWarning } from './safety';
import { createSafeFetch } from './ssrf';
import { parseConnectorConfig } from './connector';

export const PROXY_TOKEN_ENV = 'APPWEAVER_PROXY_TOKEN';
const HEALTH_HISTORY_KEEP = 50;

export type ConnectionView = {
  id: string;
  integrationId: string;
  status: string;
  healthStatus: string;
  config: Record<string, string>;
  /** Masked hint per secret field. The secret itself is never exposed. */
  maskedHints: Record<string, string>;
  envVars: string[];
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestLatencyMs: number | null;
  lastTestError: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
};

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof prisma.integrationConnection.findFirst>>>;

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

/** Maps a DB row to the client-safe view. `secretEnc` is deliberately not copied. */
export function toConnectionView(row: ConnectionRow): ConnectionView {
  const def = getIntegration(row.integrationId);
  return {
    id: row.id,
    integrationId: row.integrationId,
    status: row.status,
    healthStatus: row.healthStatus,
    config: asStringRecord(row.config),
    maskedHints: asStringRecord(row.maskedHints),
    envVars: def ? envNamesFor(def) : [],
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastTestLatencyMs: row.lastTestLatencyMs,
    lastTestError: row.lastTestError,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    usageCount: row.usageCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function envNamesFor(def: IntegrationDefinition) {
  const names = def.fields.map((f) => f.envVar).filter((v): v is string => Boolean(v));
  if (def.proxyUrlEnvVar) names.push(def.proxyUrlEnvVar, PROXY_TOKEN_ENV);
  return names;
}

export async function getOverrides() {
  const rows = await prisma.integrationCatalogueOverride.findMany();
  return new Map(rows.map((r) => [r.integrationId, { disabled: r.disabled, reason: r.reason }]));
}

export async function listPublicCatalogue(): Promise<PublicIntegration[]> {
  const overrides = await getOverrides();
  return INTEGRATIONS.map((def) => toPublicIntegration(def, overrides.get(def.id)));
}

export async function listConnections(projectId: string): Promise<ConnectionView[]> {
  const rows = await prisma.integrationConnection.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  return rows.map(toConnectionView);
}

export type ActionOutcome<T = object> = ({ ok: true } & T) | { ok: false; error: string; warning?: string };

export async function connectIntegration(input: {
  projectId: string;
  userId: string;
  integrationId: string;
  values: Record<string, unknown>;
  envVarLimit: number;
}): Promise<ActionOutcome<{ connection: ConnectionView; test: { ok: boolean; message: string; latencyMs: number } }>> {
  const def = getIntegration(input.integrationId);
  if (!def) return { ok: false, error: 'Unknown integration.' };
  if (def.status !== 'available') return { ok: false, error: `${def.name} is coming soon and cannot be connected yet.` };
  if (def.platformFeature) return { ok: false, error: `${def.name} is managed from its own panel.` };

  const override = await prisma.integrationCatalogueOverride.findUnique({ where: { integrationId: def.id } });
  if (override?.disabled) {
    return { ok: false, error: `${def.name} is temporarily disabled${override.reason ? `: ${override.reason}` : '.'}` };
  }

  const checked = validateCredentials(def, input.values);
  if (!checked.ok) return { ok: false, error: checked.error };

  const envKeys = envNamesFor(def);
  for (const key of envKeys) {
    const warning = publicSecretWarning(key);
    if (warning) return { ok: false, error: warning, warning };
    if (MANAGED_ENV_KEYS.has(key)) return { ok: false, error: `${key} is managed by AppWeaver.` };
  }

  const secrets: Record<string, string> = {};
  const config: Record<string, string> = {};
  const maskedHints: Record<string, string> = {};
  for (const field of def.fields) {
    const value = checked.values[field.key];
    if (value === undefined) continue;
    if (field.secret) {
      secrets[field.key] = value;
      maskedHints[field.key] = maskLast4(value);
    } else {
      config[field.key] = value;
    }
  }

  const limitError = await checkEnvVarLimit(input.projectId, envKeys, input.envVarLimit);
  if (limitError) return { ok: false, error: limitError };

  const secretEnc = encryptSecret(JSON.stringify(secrets));
  const row = await prisma.integrationConnection.upsert({
    where: { projectId_integrationId: { projectId: input.projectId, integrationId: def.id } },
    create: {
      projectId: input.projectId,
      integrationId: def.id,
      config,
      secretEnc,
      maskedHints,
      createdById: input.userId,
    },
    update: { config, secretEnc, maskedHints, status: 'CONNECTED', healthStatus: 'UNKNOWN', lastTestOk: null, lastTestError: null },
  });

  await injectEnvVars(input.projectId, def, { ...config, ...secrets }, row.id);

  const test = await testConnection(input.projectId, def.id);
  const fresh = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: row.id } });
  return { ok: true, connection: toConnectionView(fresh), test };
}

async function checkEnvVarLimit(projectId: string, keys: string[], limit: number) {
  if (keys.length === 0) return null;
  const present = await prisma.projectSecret.findMany({
    where: { projectId, environment: 'PRODUCTION', key: { in: [...keys, PROXY_TOKEN_ENV] } },
    select: { key: true },
  });
  const have = new Set(present.map((p) => p.key));
  const total = await prisma.projectSecret.count({ where: { projectId, environment: 'PRODUCTION' } });
  const adding = keys.filter((k) => !have.has(k)).length;
  if (total + adding > limit) {
    return `Connecting this integration needs ${adding} more environment variable(s), which would exceed your plan limit of ${limit}. Remove unused variables or upgrade.`;
  }
  return null;
}

async function injectEnvVars(projectId: string, def: IntegrationDefinition, values: Record<string, string>, connectionId: string) {
  const pairs: Array<[string, string]> = [];
  for (const field of def.fields) {
    const value = values[field.key];
    if (field.envVar && value !== undefined) pairs.push([field.envVar, value]);
  }
  if (def.proxyUrlEnvVar) {
    const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://appweaverai.com').replace(/\/$/, '');
    pairs.push([def.proxyUrlEnvVar, `${base}/api/integrations/proxy/${connectionId}`]);
    pairs.push([PROXY_TOKEN_ENV, await ensureProxyToken(projectId)]);
  }
  for (const environment of ENV_ENVIRONMENTS) {
    for (const [key, value] of pairs) await upsertEnvVar(projectId, environment, key, value);
  }
}

/** One bearer token per project authenticates calls from the generated app to the API proxy. */
async function ensureProxyToken(projectId: string): Promise<string> {
  const row = await prisma.projectSecret.findUnique({
    where: { projectId_environment_key: { projectId, environment: 'PRODUCTION', key: PROXY_TOKEN_ENV } },
    select: { value: true },
  });
  if (row) {
    try {
      return decryptSecret(row.value);
    } catch {
      // fall through and mint a new one
    }
  }
  return `awp_${randomBytes(32).toString('base64url')}`;
}

export async function getProxyToken(projectId: string): Promise<string | null> {
  const row = await prisma.projectSecret.findUnique({
    where: { projectId_environment_key: { projectId, environment: 'PRODUCTION', key: PROXY_TOKEN_ENV } },
    select: { value: true },
  });
  if (!row) return null;
  try {
    return decryptSecret(row.value);
  } catch {
    return null;
  }
}

export type DecryptedConnection = { row: ConnectionRow; def: IntegrationDefinition; values: Record<string, string> };

export async function loadConnection(projectId: string, integrationId: string): Promise<DecryptedConnection | null> {
  const def = getIntegration(integrationId);
  if (!def) return null;
  const row = await prisma.integrationConnection.findUnique({
    where: { projectId_integrationId: { projectId, integrationId } },
  });
  if (!row) return null;
  return decryptConnection(row, def);
}

export function decryptConnection(row: ConnectionRow, def: IntegrationDefinition): DecryptedConnection | null {
  try {
    const secrets = asStringRecord(JSON.parse(decryptSecret(row.secretEnc)));
    return { row, def, values: { ...asStringRecord(row.config), ...secrets } };
  } catch {
    return null;
  }
}

export type HealthStatus = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN';

export function nextHealthStatus(ok: boolean, recent: boolean[]): HealthStatus {
  if (ok) return 'HEALTHY';
  const lastThree = recent.slice(0, 3);
  return lastThree.length >= 3 && lastThree.every((x) => !x) ? 'DOWN' : 'DEGRADED';
}

/** Runs the catalogue's real read-only call and records the outcome (latency, health, history). */
export async function testConnection(projectId: string, integrationId: string) {
  const loaded = await loadConnection(projectId, integrationId);
  if (!loaded) return { ok: false, message: 'Connection not found.', latencyMs: 0 };
  return runTest(loaded);
}

export async function runTest(loaded: DecryptedConnection, fetchImpl: typeof fetch = fetch) {
  const { row, def, values } = loaded;
  const started = Date.now();
  let result: { ok: boolean; message: string };
  try {
    if (!def.test) throw new Error('no test');
    const config = parseConnectorConfig(values);
    result = await def.test(values, {
      fetch: fetchImpl,
      safeFetch: createSafeFetch({ timeoutMs: config.timeoutMs, maxBytes: config.maxResponseKb * 1024 }),
    });
  } catch {
    result = { ok: false, message: 'The connection test failed unexpectedly.' };
  }
  const latencyMs = Date.now() - started;

  const history = await prisma.integrationHealthCheck.findMany({
    where: { connectionId: row.id },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { ok: true },
  });
  const health = nextHealthStatus(result.ok, history.map((h) => h.ok));
  await prisma.$transaction([
    prisma.integrationHealthCheck.create({
      data: { connectionId: row.id, projectId: row.projectId, integrationId: row.integrationId, ok: result.ok, latencyMs, error: result.ok ? null : result.message },
    }),
    prisma.integrationConnection.update({
      where: { id: row.id },
      data: {
        status: result.ok ? 'CONNECTED' : 'ERROR',
        healthStatus: health,
        lastTestAt: new Date(),
        lastTestOk: result.ok,
        lastTestLatencyMs: latencyMs,
        lastTestError: result.ok ? null : result.message,
      },
    }),
  ]);
  const old = await prisma.integrationHealthCheck.findMany({
    where: { connectionId: row.id },
    orderBy: { createdAt: 'desc' },
    skip: HEALTH_HISTORY_KEEP,
    select: { id: true },
  });
  if (old.length) await prisma.integrationHealthCheck.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return { ok: result.ok, message: result.message, latencyMs };
}

/** Deletes the stored secret and every env var this integration injected. */
export async function disconnectIntegration(projectId: string, integrationId: string): Promise<ActionOutcome> {
  const def = getIntegration(integrationId);
  const existing = await prisma.integrationConnection.findUnique({
    where: { projectId_integrationId: { projectId, integrationId } },
    select: { id: true },
  });
  if (!def || !existing) return { ok: false, error: 'Connection not found.' };

  const keys = def.fields.map((f) => f.envVar).filter((v): v is string => Boolean(v));
  if (def.proxyUrlEnvVar) keys.push(def.proxyUrlEnvVar);
  for (const environment of ENV_ENVIRONMENTS) {
    for (const key of keys) await deleteEnvVar(projectId, environment, key);
  }
  await prisma.integrationConnection.delete({ where: { id: existing.id } });

  const remainingProxy = await prisma.integrationConnection.count({
    where: { projectId, integrationId: { in: INTEGRATIONS.filter((i) => i.proxyUrlEnvVar).map((i) => i.id) } },
  });
  if (remainingProxy === 0) {
    for (const environment of ENV_ENVIRONMENTS) await deleteEnvVar(projectId, environment, PROXY_TOKEN_ENV);
  }
  return { ok: true };
}

export async function recordUsage(connectionId: string) {
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

/** Re-tests connections that have not been checked in the last day. Used by the daily cron. */
export async function runHealthSweep(limit = 25) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.integrationConnection.findMany({
    where: { OR: [{ lastTestAt: null }, { lastTestAt: { lt: cutoff } }] },
    orderBy: { lastTestAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
  });
  let checked = 0;
  let failed = 0;
  for (const row of rows) {
    const def = getIntegration(row.integrationId);
    const disabled = await prisma.integrationCatalogueOverride.findUnique({ where: { integrationId: row.integrationId } });
    if (!def?.test || disabled?.disabled) continue;
    const loaded = decryptConnection(row, def);
    if (!loaded) continue;
    const result = await runTest(loaded);
    checked += 1;
    if (!result.ok) failed += 1;
  }
  return { checked, failed };
}

export type AgentIntegrationSummary = { name: string; id: string; envVars: string[] };

/** Names and env var names only. Values are never read. */
export async function getConnectedIntegrationsForAgent(projectId: string): Promise<AgentIntegrationSummary[]> {
  const rows = await prisma.integrationConnection.findMany({
    where: { projectId, status: 'CONNECTED' },
    select: { integrationId: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.flatMap((r) => {
    const def = getIntegration(r.integrationId);
    return def ? [{ id: def.id, name: def.name, envVars: envNamesFor(def) }] : [];
  });
}

export function formatAgentIntegrationContext(items: AgentIntegrationSummary[]): string | null {
  if (items.length === 0) return null;
  const lines = items.map((i) => {
    const def = getIntegration(i.id);
    const env = i.envVars.length ? ` (env vars: ${i.envVars.join(', ')})` : '';
    return `- ${i.name}${env}${def?.setup ? ` — setup template available in the integrations page` : ''}`;
  });
  return [
    'Connected integrations (credentials are already configured as server-side environment variables; their values are not available to you):',
    ...lines,
    'Rules: read these only on the server (route handlers, server actions, edge functions) via process.env. NEVER embed values in frontend code, never prefix them with NEXT_PUBLIC_/VITE_/REACT_APP_, and never invent or hard-code keys. Static HTML/browser-only apps must call a server endpoint instead of the third-party API directly.',
  ].join('\n');
}
