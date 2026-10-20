import { z } from 'zod';

import { encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';

export const ENV_ENVIRONMENTS = ['DEVELOPMENT', 'STAGING', 'PRODUCTION'] as const;
export type EnvEnvironment = (typeof ENV_ENVIRONMENTS)[number];

/** Keys written by the platform (e.g. managed database); not editable here. */
export const MANAGED_ENV_KEYS: ReadonlySet<string> = new Set(['DATABASE_URL']);

export const MAX_ENV_VALUE_LENGTH = 8_192;

export const envVarSchema = z.object({
  environment: z.enum(ENV_ENVIRONMENTS),
  key: z
    .string()
    .trim()
    .min(1, 'Enter a variable name.')
    .max(128)
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      'Names may only contain letters, numbers and underscores, and cannot start with a number.',
    ),
  value: z
    .string()
    .min(1, 'Enter a value.')
    .max(MAX_ENV_VALUE_LENGTH, `Values are limited to ${MAX_ENV_VALUE_LENGTH} characters.`),
});

/** Fixed-length mask so neither the value nor its length is revealed. */
export const MASKED_VALUE = '••••••••';

export async function listEnvVars(
  projectId: string,
  environment: EnvEnvironment,
) {
  const rows = await prisma.projectSecret.findMany({
    where: { projectId, environment },
    orderBy: { key: 'asc' },
    select: { key: true, updatedAt: true },
  });
  return rows.map((row) => ({
    key: row.key,
    masked: MASKED_VALUE,
    managed: MANAGED_ENV_KEYS.has(row.key),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function countEnvVars(
  projectId: string,
  environment: EnvEnvironment,
) {
  return prisma.projectSecret.count({ where: { projectId, environment } });
}

export async function envVarExists(
  projectId: string,
  environment: EnvEnvironment,
  key: string,
) {
  const row = await prisma.projectSecret.findUnique({
    where: { projectId_environment_key: { projectId, environment, key } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function upsertEnvVar(
  projectId: string,
  environment: EnvEnvironment,
  key: string,
  value: string,
) {
  const encrypted = encryptSecret(value);
  await prisma.projectSecret.upsert({
    where: { projectId_environment_key: { projectId, environment, key } },
    create: { projectId, environment, key, value: encrypted },
    update: { value: encrypted },
  });
}

export async function deleteEnvVar(
  projectId: string,
  environment: EnvEnvironment,
  key: string,
) {
  await prisma.projectSecret.deleteMany({
    where: { projectId, environment, key },
  });
}
