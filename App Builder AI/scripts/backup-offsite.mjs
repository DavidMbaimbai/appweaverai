#!/usr/bin/env node
// Off-site backup storage + reporting. Used by .github/workflows/backup.yml (see docs/runbooks/backup-restore.md).
//   node scripts/backup-offsite.mjs upload          upload the newest dump in BACKUP_DIR (+ sidecar) to S3, apply retention, report
//   node scripts/backup-offsite.mjs fetch-latest    download the newest dump (+ sidecar) from S3 into BACKUP_DIR, verify its checksum
//   node scripts/backup-offsite.mjs report-failure "<message>" [BACKUP|RESTORE_DRILL]
//
// Env: BACKUP_S3_BUCKET (required), BACKUP_S3_PREFIX (db-backups/), AWS_REGION, standard AWS credentials,
//      BACKUP_S3_SSE (AES256 | aws:kms, default AES256), BACKUP_S3_KMS_KEY_ID,
//      BACKUP_RETENTION_DAYS (30), BACKUP_MIN_KEEP (7), BACKUP_DIR (backups),
//      BACKUP_REPORT_URL + CRON_SECRET (POSTs the result so /admin/backups and the alerts see it).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const [command, ...rest] = process.argv.slice(2);
const dir = process.env.BACKUP_DIR || 'backups';
const bucket = process.env.BACKUP_S3_BUCKET;
const prefix = (process.env.BACKUP_S3_PREFIX || 'db-backups/').replace(/^\/+/, '').replace(/\/?$/, '/');
const sse = process.env.BACKUP_S3_SSE || 'AES256';
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
const minKeep = Number(process.env.BACKUP_MIN_KEEP || 7);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function report(body) {
  const target = process.env.BACKUP_REPORT_URL?.trim();
  if (!target) {
    console.warn('BACKUP_REPORT_URL not set; result was not reported to the app.');
    return;
  }
  const res = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) console.error(`Report to app failed: HTTP ${res.status}`);
  else console.log('Reported result to the app.');
}

function client() {
  if (!bucket) fail('BACKUP_S3_BUCKET is required.');
  return new S3Client({ region: process.env.BACKUP_S3_REGION || process.env.AWS_REGION });
}

async function listDumps(s3) {
  const objects = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    objects.push(...(page.Contents ?? []));
    token = page.NextContinuationToken;
  } while (token);
  return objects.filter((o) => o.Key?.endsWith('.dump')).sort((a, b) => a.Key.localeCompare(b.Key));
}

async function upload() {
  const startedAt = new Date();
  const s3 = client();
  const dumps = readdirSync(dir).filter((f) => f.endsWith('.dump')).sort();
  if (!dumps.length) fail(`No .dump files in ${dir}.`);
  const file = dumps[dumps.length - 1];
  const data = readFileSync(path.join(dir, file));
  const sidecarRaw = readFileSync(path.join(dir, `${file}.json`), 'utf8');
  const sidecar = JSON.parse(sidecarRaw);
  const encryption = { ServerSideEncryption: sse, ...(sse === 'aws:kms' && process.env.BACKUP_S3_KMS_KEY_ID ? { SSEKMSKeyId: process.env.BACKUP_S3_KMS_KEY_ID } : {}) };

  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + file, Body: data, ContentType: 'application/octet-stream', ...encryption }));
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}${file}.json`, Body: sidecarRaw, ContentType: 'application/json', ...encryption }));
  console.log(`Uploaded s3://${bucket}/${prefix}${file} (${data.length} bytes, SSE=${sse})`);

  // Retention: drop dumps older than BACKUP_RETENTION_DAYS, but always keep the newest BACKUP_MIN_KEEP.
  const dumpsInBucket = await listDumps(s3);
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const deletable = dumpsInBucket.slice(0, Math.max(0, dumpsInBucket.length - minKeep)).filter((o) => o.LastModified && o.LastModified.getTime() < cutoff);
  if (deletable.length) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: deletable.flatMap((o) => [{ Key: o.Key }, { Key: `${o.Key}.json` }]), Quiet: true },
    }));
  }
  console.log(`Retention: removed ${deletable.length} dump(s) older than ${retentionDays} days.`);

  await report({
    kind: 'BACKUP',
    status: 'SUCCESS',
    trigger: process.env.BACKUP_TRIGGER === 'MANUAL' ? 'MANUAL' : 'SCHEDULE',
    location: `s3://${bucket}/${prefix}${file}`,
    sizeBytes: data.length,
    checksumSha256: sidecar.sha256,
    encrypted: true,
    retentionDeleted: deletable.length,
    rowCounts: sidecar.rowCounts?.after,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  });
}

async function fetchLatest() {
  const s3 = client();
  const dumps = await listDumps(s3);
  if (!dumps.length) fail(`No dumps under s3://${bucket}/${prefix}`);
  const latest = dumps[dumps.length - 1].Key;
  mkdirSync(dir, { recursive: true });
  const get = async (key) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToByteArray());
  const name = path.basename(latest);
  const data = await get(latest);
  const sidecarRaw = (await get(`${latest}.json`)).toString('utf8');
  const expected = JSON.parse(sidecarRaw).sha256;
  const actual = createHash('sha256').update(data).digest('hex');
  if (expected && expected !== actual) fail(`Checksum mismatch for ${latest}: expected ${expected}, got ${actual}.`);
  writeFileSync(path.join(dir, name), data);
  writeFileSync(path.join(dir, `${name}.json`), sidecarRaw);
  console.log(`Fetched ${latest} -> ${path.join(dir, name)} (${data.length} bytes, checksum OK)`);
}

try {
  if (command === 'upload') await upload();
  else if (command === 'fetch-latest') await fetchLatest();
  else if (command === 'report-failure') {
    const now = new Date().toISOString();
    await report({
      kind: rest[1] === 'RESTORE_DRILL' ? 'RESTORE_DRILL' : 'BACKUP',
      status: 'FAILED',
      trigger: process.env.BACKUP_TRIGGER === 'MANUAL' ? 'MANUAL' : 'SCHEDULE',
      error: (rest[0] || 'Workflow failed.').slice(0, 4000),
      startedAt: now,
      finishedAt: now,
    });
  } else fail('Usage: node scripts/backup-offsite.mjs upload | fetch-latest | report-failure "<message>" [kind]');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`backup-offsite ${command} failed: ${message}`);
  if (command === 'upload') {
    const now = new Date().toISOString();
    await report({ kind: 'BACKUP', status: 'FAILED', error: message.slice(0, 4000), startedAt: now, finishedAt: now }).catch(() => undefined);
  }
  process.exit(1);
}
