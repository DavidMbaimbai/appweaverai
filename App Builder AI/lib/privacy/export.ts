import { createHmac, timingSafeEqual } from 'node:crypto';

import { strToU8, unzipSync, zipSync } from 'fflate';

import { prisma } from '@/lib/prisma';

import { privacySecret } from './identifiers';
import { deleteObjects, getPrivateObject, privacyStorageConfigured, putPrivateObject } from './storage';
import { collectUserData } from './user-data';

export const EXPORT_TTL_MS = 7 * 86_400_000;
export const DOWNLOAD_LINK_TTL_MS = 15 * 60_000;
export const EXPORT_DAILY_LIMIT = 3;
const STALE_RUNNING_MS = 15 * 60_000;

export type ExportRequestResult = { ok: true; jobId: string; reused: boolean } | { ok: false; error: string };

/** Queues an account export. At most one job runs at a time and three may be requested per rolling day. */
export async function requestUserExport(userId: string, now = new Date()): Promise<ExportRequestResult> {
  const active = await prisma.privacyExportJob.findFirst({
    where: { userId, status: { in: ['QUEUED', 'RUNNING'] }, createdAt: { gt: new Date(now.getTime() - STALE_RUNNING_MS * 2) } },
    orderBy: { createdAt: 'desc' },
  });
  if (active) return { ok: true, jobId: active.id, reused: true };

  const recent = await prisma.privacyExportJob.count({ where: { userId, createdAt: { gt: new Date(now.getTime() - 86_400_000) } } });
  if (recent >= EXPORT_DAILY_LIMIT) {
    return { ok: false, error: `You can request ${EXPORT_DAILY_LIMIT} exports per day. Please try again tomorrow.` };
  }
  const job = await prisma.privacyExportJob.create({ data: { userId, createdAt: now } });
  return { ok: true, jobId: job.id, reused: false };
}

const README = `AppWeaver AI account data export

manifest.json lists every section with its record count. export.json contains all sections in one file;
data/<section>.json contains the same data split per section. Credentials (tokens, password hashes and
encrypted secrets) are intentionally excluded. Project source files are available from each project's
own export. Visitor page-view analytics are included as a count only.
`;

export function buildExportZip(userId: string, generatedAt: Date, sections: Record<string, unknown>, counts: Record<string, number>) {
  const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2));
  const files: Record<string, Uint8Array> = {
    'README.txt': strToU8(README),
    'manifest.json': json({ userId, generatedAt: generatedAt.toISOString(), format: 1, counts }),
    'export.json': json({ userId, generatedAt: generatedAt.toISOString(), ...sections }),
  };
  for (const [name, value] of Object.entries(sections)) files[`data/${name}.json`] = json(value);
  return Buffer.from(zipSync(files, { level: 6 }));
}

/** Claims and runs one queued job. Safe to call twice: only one caller wins the claim. */
export async function runExportJob(jobId: string, now = new Date()) {
  const claimed = await prisma.privacyExportJob.updateMany({
    where: { id: jobId, status: 'QUEUED' },
    data: { status: 'RUNNING', startedAt: now },
  });
  if (claimed.count === 0) return { ran: false as const };
  const job = await prisma.privacyExportJob.findUniqueOrThrow({ where: { id: jobId } });
  try {
    const { sections, counts } = await collectUserData(job.userId);
    const zip = buildExportZip(job.userId, now, sections, counts);
    const useBucket = privacyStorageConfigured();
    const storageKey = useBucket ? `privacy-exports/${job.userId}/${job.id}.zip` : null;
    if (storageKey) await putPrivateObject(storageKey, zip, 'application/zip');
    await prisma.privacyExportJob.update({
      where: { id: job.id },
      data: {
        status: 'READY',
        completedAt: new Date(),
        expiresAt: new Date(now.getTime() + EXPORT_TTL_MS),
        storageKey,
        data: useBucket ? null : new Uint8Array(zip),
        sizeBytes: zip.length,
        error: null,
      },
    });
    return { ran: true as const, ok: true as const };
  } catch (error) {
    await prisma.privacyExportJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', completedAt: new Date(), error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
    });
    return { ran: true as const, ok: false as const };
  }
}

/** Cron sweep: runs queued jobs, requeues jobs stuck mid-run, and deletes expired files. */
export async function processExportQueue(now = new Date(), limit = 5) {
  await prisma.privacyExportJob.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
    data: { status: 'QUEUED' },
  });
  const queued = await prisma.privacyExportJob.findMany({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } });
  let ran = 0;
  for (const { id } of queued) if ((await runExportJob(id, now)).ran) ran += 1;
  const expired = await expireExports(now);
  return { ran, expired };
}

export async function expireExports(now = new Date()) {
  const due = await prisma.privacyExportJob.findMany({ where: { status: 'READY', expiresAt: { lt: now } }, select: { id: true, storageKey: true } });
  if (due.length === 0) return 0;
  await deleteObjects(due.map((d) => d.storageKey).filter((k): k is string => Boolean(k)));
  await prisma.privacyExportJob.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { status: 'EXPIRED', data: null, storageKey: null } });
  return due.length;
}

function sign(payload: string) {
  return createHmac('sha256', privacySecret()).update(`export-download:${payload}`).digest('base64url');
}

export function signDownloadToken(jobId: string, now = new Date()) {
  const payload = `${jobId}.${now.getTime() + DOWNLOAD_LINK_TTL_MS}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

/** Returns the job id for a valid, unexpired link; null otherwise. */
export function verifyDownloadToken(token: string, now = new Date()): string | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, 'base64url').toString();
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const separator = payload.lastIndexOf('.');
  const expiresAt = Number(payload.slice(separator + 1));
  if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) return null;
  return payload.slice(0, separator);
}

export async function loadExportBytes(job: { storageKey: string | null; data: Uint8Array | null }): Promise<Buffer | null> {
  if (job.storageKey) return getPrivateObject(job.storageKey);
  return job.data ? Buffer.from(job.data) : null;
}

/** The single-file JSON variant, taken out of the stored zip. */
export function exportJsonFromZip(zip: Buffer) {
  const entry = unzipSync(new Uint8Array(zip), { filter: (file) => file.name === 'export.json' })['export.json'];
  return entry ? Buffer.from(entry) : null;
}

export async function listUserExports(userId: string) {
  const jobs = await prisma.privacyExportJob.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 });
  return jobs.map((j) => ({
    id: j.id,
    status: j.status,
    createdAt: j.createdAt.toISOString(),
    expiresAt: j.expiresAt?.toISOString() ?? null,
    sizeBytes: j.sizeBytes,
    error: j.status === 'FAILED' ? j.error : null,
  }));
}
