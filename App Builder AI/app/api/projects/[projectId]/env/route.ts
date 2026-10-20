import { z } from 'zod';

import { recordUserActivity } from '@/lib/activity/record-user-activity';
import { requireProjectAccess } from '@/lib/hosting/api-auth';
import { publicSecretWarning } from '@/lib/integrations/safety';
import { denyWithoutCapability } from '@/lib/team/http';
import { envVarLimitMessage, getHostingLimits } from '@/lib/hosting/limits';
import {
  countEnvVars,
  deleteEnvVar,
  ENV_ENVIRONMENTS,
  envVarExists,
  envVarSchema,
  listEnvVars,
  MANAGED_ENV_KEYS,
  upsertEnvVar,
} from '@/lib/projects/env-vars';

type Context = { params: Promise<{ projectId: string }> };

const environmentSchema = z.enum(ENV_ENVIRONMENTS);

export async function GET(request: Request, context: Context) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;
  const denied = await denyWithoutCapability(access.userId, projectId, 'view_secrets');
  if (denied) return denied;

  const environment = environmentSchema.safeParse(
    new URL(request.url).searchParams.get('environment') ?? 'PRODUCTION',
  );
  if (!environment.success) {
    return Response.json({ error: 'Invalid environment.' }, { status: 400 });
  }

  return Response.json({
    variables: await listEnvVars(projectId, environment.data),
    limit: getHostingLimits(access.tier).envVarsPerEnvironment,
  });
}

/** Creates or replaces a variable. Values are encrypted and never returned. */
export async function PUT(request: Request, context: Context) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;
  const denied = await denyWithoutCapability(access.userId, projectId, 'manage_env_vars');
  if (denied) return denied;

  const parsed = envVarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid variable.' },
      { status: 400 },
    );
  }
  const { environment, key, value } = parsed.data;

  if (MANAGED_ENV_KEYS.has(key)) {
    return Response.json(
      { error: `${key} is managed by AppWeaver and cannot be edited here.` },
      { status: 400 },
    );
  }

  const limit = getHostingLimits(access.tier).envVarsPerEnvironment;
  const exists = await envVarExists(projectId, environment, key);
  if (!exists && (await countEnvVars(projectId, environment)) >= limit) {
    return Response.json(
      { error: envVarLimitMessage(access.tier, limit), upgradeRequired: true },
      { status: 403 },
    );
  }

  await upsertEnvVar(projectId, environment, key, value);
  await recordUserActivity({
    userId: access.userId,
    action: 'project.env_var_set',
    targetType: 'Project',
    targetId: projectId,
    after: { key, environment },
  });

  return Response.json({
    success: true,
    warning: publicSecretWarning(key) ?? undefined,
    variables: await listEnvVars(projectId, environment),
  });
}

export async function DELETE(request: Request, context: Context) {
  const { projectId } = await context.params;
  const access = await requireProjectAccess(projectId);
  if ('error' in access) return access.error;
  const denied = await denyWithoutCapability(access.userId, projectId, 'manage_env_vars');
  if (denied) return denied;

  const parsed = envVarSchema
    .pick({ environment: true, key: true })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid variable.' }, { status: 400 });
  }
  const { environment, key } = parsed.data;

  if (MANAGED_ENV_KEYS.has(key)) {
    return Response.json(
      { error: `${key} is managed by AppWeaver and cannot be removed here.` },
      { status: 400 },
    );
  }

  await deleteEnvVar(projectId, environment, key);
  await recordUserActivity({
    userId: access.userId,
    action: 'project.env_var_removed',
    targetType: 'Project',
    targetId: projectId,
    after: { key, environment },
  });

  return Response.json({
    success: true,
    variables: await listEnvVars(projectId, environment),
  });
}
