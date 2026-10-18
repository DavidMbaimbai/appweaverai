import { randomBytes } from 'node:crypto';

import { Client } from 'pg';

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret-box';
import { prisma } from '@/lib/prisma';

export type DbEnvironment = 'DEVELOPMENT' | 'PRODUCTION';

const SECRET_KEY = 'DATABASE_URL';

/**
 * Managed Postgres: one isolated database + login role per project and
 * environment, created on a shared server reachable with MANAGED_DB_ADMIN_URL.
 * MANAGED_DB_HOST ("host:port") is the address apps/containers use to reach
 * that server (e.g. host.docker.internal:5432 for a local Docker preview).
 */
export function isManagedDatabaseConfigured() {
  return Boolean(
    process.env.MANAGED_DB_ADMIN_URL && process.env.MANAGED_DB_HOST,
  );
}

/** Safe SQL identifier derived from ids we generate ourselves (cuid). */
export function databaseIdentifier(
  projectId: string,
  environment: DbEnvironment,
) {
  const suffix = environment === 'PRODUCTION' ? 'prod' : 'dev';
  const name = `aw_${projectId.toLowerCase().replace(/[^a-z0-9]/g, '')}_${suffix}`;
  if (!/^aw_[a-z0-9]+_(dev|prod)$/.test(name) || name.length > 63) {
    throw new Error('Invalid project id for database name.');
  }
  return name;
}

/** Env vars the generated Spring Boot / FastAPI backends read. */
export function connectionEnvFromUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get('sslmode');
  const jdbc = `jdbc:postgresql://${url.host}${url.pathname}${sslmode ? `?sslmode=${sslmode}` : ''}`;

  return {
    DATABASE_URL: databaseUrl,
    DATABASE_JDBC_URL: jdbc,
    DATABASE_USERNAME: decodeURIComponent(url.username),
    DATABASE_PASSWORD: decodeURIComponent(url.password),
  };
}

async function withAdminClient<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({
    connectionString: process.env.MANAGED_DB_ADMIN_URL,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export async function getDatabaseUrl(
  projectId: string,
  environment: DbEnvironment,
) {
  const secret = await prisma.projectSecret.findUnique({
    where: {
      projectId_environment_key: { projectId, environment, key: SECRET_KEY },
    },
    select: { value: true },
  });
  return secret ? decryptSecret(secret.value) : null;
}

/** Creates the project's database for `environment` if needed (idempotent). */
export async function provisionProjectDatabase(
  projectId: string,
  environment: DbEnvironment,
) {
  if (!isManagedDatabaseConfigured()) {
    throw new Error(
      'Managed database is not configured (MANAGED_DB_ADMIN_URL, MANAGED_DB_HOST).',
    );
  }

  const existing = await getDatabaseUrl(projectId, environment);
  if (existing) return existing;

  const name = databaseIdentifier(projectId, environment);
  const password = randomBytes(24).toString('hex');
  const sslmode = process.env.MANAGED_DB_SSLMODE;
  const databaseUrl = `postgresql://${name}:${password}@${process.env.MANAGED_DB_HOST}/${name}${sslmode ? `?sslmode=${sslmode}` : ''}`;

  await withAdminClient(async (client) => {
    // Identifiers are validated above and the password is hex, so these
    // statements (which cannot take bind parameters) are injection-safe.
    await client.query(
      `CREATE ROLE "${name}" LOGIN PASSWORD '${password}' CONNECTION LIMIT 20`,
    );
    try {
      await client.query(`GRANT "${name}" TO CURRENT_USER`);
      await client.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
      await client.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    } catch (error) {
      await client.query(`DROP ROLE IF EXISTS "${name}"`).catch(() => {});
      throw error;
    }
  });

  await prisma.$transaction([
    prisma.projectSecret.upsert({
      where: {
        projectId_environment_key: { projectId, environment, key: SECRET_KEY },
      },
      create: {
        projectId,
        environment,
        key: SECRET_KEY,
        value: encryptSecret(databaseUrl),
      },
      update: { value: encryptSecret(databaseUrl) },
    }),
    prisma.projectDatabase.upsert({
      where: { projectId_environment: { projectId, environment } },
      create: {
        projectId,
        environment,
        provider: 'POSTGRES',
        databaseName: name,
        host: process.env.MANAGED_DB_HOST,
      },
      update: { isActive: true, databaseName: name },
    }),
  ]);

  return databaseUrl;
}

export async function dropProjectDatabase(
  projectId: string,
  environment: DbEnvironment,
) {
  if (isManagedDatabaseConfigured()) {
    const name = databaseIdentifier(projectId, environment);
    await withAdminClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await client.query(`DROP ROLE IF EXISTS "${name}"`);
    });
  }

  await prisma.projectSecret.deleteMany({
    where: { projectId, environment, key: SECRET_KEY },
  });
  await prisma.projectDatabase.deleteMany({
    where: { projectId, environment },
  });
}

/** Best-effort cleanup used when a project is permanently deleted. */
export async function dropAllProjectDatabases(projectId: string) {
  for (const environment of ['DEVELOPMENT', 'PRODUCTION'] as const) {
    await dropProjectDatabase(projectId, environment).catch((error) => {
      console.error(
        `[managed-db] failed to drop ${environment} database for ${projectId}:`,
        error,
      );
    });
  }
}
