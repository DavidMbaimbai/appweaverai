import { NextResponse } from 'next/server';

import { checkBackupHealthAndAlert, backupReportSchema, recordBackupRun } from '@/lib/backups';
import { monitoredCron } from '@/lib/monitoring/cron';
import { hasBearerSecret } from '@/lib/rate-limit';

function authorize(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }
  if (!hasBearerSecret(request, cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });
  }
  return null;
}

/** Daily watchdog: alerts when backups are missing, stale or failing, or restore drills are overdue. */
export const GET = monitoredCron('backups-watchdog', async (request) => {
  const denied = authorize(request);
  if (denied) return denied;
  const health = await checkBackupHealthAndAlert();
  return NextResponse.json({ success: true, ...health });
});

/** Called by the backup workflow (.github/workflows/backup.yml) to record a backup or restore-drill result. */
export const POST = monitoredCron('backups-report', async (request) => {
  const denied = authorize(request);
  if (denied) return denied;
  const parsed = backupReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid backup report.', issues: parsed.error.issues }, { status: 400 });
  }
  const run = await recordBackupRun(parsed.data);
  return NextResponse.json({ success: true, id: run.id });
});
