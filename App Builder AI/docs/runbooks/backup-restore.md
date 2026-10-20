# Backup and restore runbook

## How it works

- `.github/workflows/backup.yml` runs daily (02:15 UTC): `pg_dump` of production, uploaded to S3 (server-side encryption), retention applied (`BACKUP_RETENTION_DAYS`, always keeping `BACKUP_MIN_KEEP`), then the result is POSTed to `/api/cron/backups` and stored in `BackupRun`.
- A weekly job in the same workflow downloads the latest dump (checksum verified) and runs the restore drill against a postgres:16 service container.
- Vercel cron `/api/cron/backups` (09:00 UTC) is a watchdog. It alerts through `lib/alerts.ts` (`ALERT_WEBHOOK_URL` / `ALERT_EMAIL`) when there is no successful backup, the last one is older than `BACKUP_MAX_AGE_HOURS` (30), the latest run failed, or the latest drill failed. A drill older than `BACKUP_DRILL_MAX_AGE_DAYS` (10) is a warning.
- Admin page: `/admin/backups` (`backups:read`; "Run health check" needs `backups:write`).

## One-time setup

GitHub repository secrets: `PRODUCTION_DATABASE_URL`, `BACKUP_S3_BUCKET`, `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY` (and region), `BACKUP_REPORT_URL`, `CRON_SECRET` (same value as in Vercel).

S3 bucket: block public access, enable versioning, default encryption (SSE-S3 or SSE-KMS), and use a least-privilege IAM user (`s3:PutObject`, `GetObject`, `ListBucket`, `DeleteObject` on the prefix). Dumps are encrypted at rest by S3 only; add client-side encryption if the threat model requires it. Use a pg_dump major version >= the server's.

## Restore (real incident)

1. Download the dump and its `.json` sidecar: `node scripts/backup-offsite.mjs fetch-latest` (verifies sha256), or fetch from S3 manually.
2. Create an empty target database (never restore over a live one without a snapshot).
3. `pg_restore --no-owner --no-privileges --clean --if-exists -d "$TARGET_URL" file.dump`
4. Compare row counts with the sidecar, run `npx prisma migrate status`, then repoint `DATABASE_URL`.

## Restore drill (local, safe)

```
npm run db:restore-drill                  # restores the newest dump in ./backups
npm run db:restore-drill -- --self-source # builds a throwaway source DB, dumps and restores it
```

Local Docker: set `BACKUP_DOCKER_CONTAINER=appweaverai-postgres` (no host `pg_dump` needed). The drill only uses throwaway databases named `appweaverai_it_*` on localhost, verifies row counts against the sidecar, requires `_prisma_migrations`, and drops the databases afterwards. With `BACKUP_REPORT_URL` set it records the result as a `RESTORE_DRILL` run.

## Local backups

`npm run db:backup` writes `./backups/*.dump` plus a `.json` sidecar (sha256, size, row counts). `npm run db:backup-offsite -- upload <file>` uploads to S3.
