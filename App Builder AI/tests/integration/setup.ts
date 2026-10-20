import { afterAll, beforeEach, inject } from 'vitest';

import { assertSafeTestDatabaseUrl } from './guard';
import { closeRawPool, resetDatabase } from './db';

const url = inject('integrationDatabaseUrl');
assertSafeTestDatabaseUrl(url);

// The app's own prisma client (lib/prisma.ts) reads DATABASE_URL lazily; point it at the throwaway database.
process.env.DATABASE_URL = url;
process.env.BETTER_AUTH_SECRET = 'integration-test-secret-not-for-production';
process.env.STRIPE_SECRET_KEY = 'sk_test_integration_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integration_dummy';
process.env.CRON_SECRET = 'integration-cron-secret';
process.env.VIDEO_S3_BUCKET = 'integration-bucket';
process.env.MARKETING_CREDITS_ENABLED = 'true';
for (const name of [
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'ALERT_WEBHOOK_URL', 'ALERT_EMAIL', 'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN', 'PLATFORM_ADMIN_USER_IDS', 'PLATFORM_WORKSPACE_IDS', 'PROJECT_MARKETING_DRY_RUN',
  'VIDEO_RELEASE_DRY_RUN', 'MEDIA_PUBLIC_BASE_URL',
]) {
  delete process.env[name];
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeRawPool();
  const { prisma } = await import('@/lib/prisma');
  await prisma.$disconnect();
});
