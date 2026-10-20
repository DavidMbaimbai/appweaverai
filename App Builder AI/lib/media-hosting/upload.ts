import { prisma } from '@/lib/prisma';
import { getVideoObjectSize, getVideoStorageConfig, putVideoObject } from '@/lib/video/storage';

import { buildMediaKey, realSleep, backoffMs, validateMedia, type MediaKindName, type Sleep } from './logic';

export type MediaScope = { scopeKey: string; projectId?: string | null; ownerUserId?: string | null };

export type UploadInput = {
  scope: MediaScope;
  kind: MediaKindName;
  bytes: Buffer;
  contentType: string;
  /** Public assets are only served at a permanent URL when MEDIA_PUBLIC_BASE_URL is set; private is the default. */
  visibility?: 'PRIVATE' | 'PUBLIC';
  expectedSha256?: string;
  contentRunId?: string;
  videoJobId?: string;
  attempts?: number;
  sleep?: Sleep;
};

export type UploadResult =
  | { ok: true; asset: NonNullable<Awaited<ReturnType<typeof prisma.mediaAsset.findUnique>>>; reused: boolean }
  | { ok: false; error: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Validates, uploads (retrying transient S3 errors with backoff), verifies the stored size, then records the asset. Never reports success unless the object is stored. */
export async function uploadMedia(input: UploadInput): Promise<UploadResult> {
  const config = getVideoStorageConfig();
  if (!config.ok) return { ok: false, error: config.reason };
  const checked = validateMedia({ kind: input.kind, bytes: input.bytes, contentType: input.contentType, expectedSha256: input.expectedSha256 });
  if (!checked.ok) return checked;

  const visibility = input.visibility ?? 'PRIVATE';
  if (input.contentRunId) {
    const existing = await prisma.mediaAsset.findFirst({
      where: { scopeKey: input.scope.scopeKey, sha256: checked.sha256, contentRunId: input.contentRunId, status: 'READY' },
    });
    if (existing) return { ok: true, asset: existing, reused: true };
  }

  const key = buildMediaKey({ scopeKey: input.scope.scopeKey, visibility, contentType: checked.contentType, sha256: checked.sha256 });
  const sleep = input.sleep ?? realSleep;
  const attempts = input.attempts ?? 3;
  let lastError = 'Upload failed.';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await putVideoObject(key, input.bytes, checked.contentType);
      const stored = await getVideoObjectSize(key);
      if (stored !== checked.sizeBytes) throw new Error(`Stored object size ${stored ?? 'missing'} does not match ${checked.sizeBytes}.`);
      const asset = await prisma.mediaAsset.create({
        data: {
          scopeKey: input.scope.scopeKey,
          projectId: input.scope.projectId ?? null,
          ownerUserId: input.scope.ownerUserId ?? null,
          kind: input.kind,
          visibility,
          status: 'READY',
          key,
          contentType: checked.contentType,
          sizeBytes: checked.sizeBytes,
          sha256: checked.sha256,
          contentRunId: input.contentRunId ?? null,
          videoJobId: input.videoJobId ?? null,
        },
      });
      return { ok: true, asset, reused: false };
    } catch (error) {
      lastError = message(error);
      if (attempt < attempts - 1) await sleep(backoffMs(attempt, 500, 4000));
    }
  }

  await prisma.mediaAsset
    .create({
      data: {
        scopeKey: input.scope.scopeKey,
        projectId: input.scope.projectId ?? null,
        ownerUserId: input.scope.ownerUserId ?? null,
        kind: input.kind,
        visibility,
        status: 'FAILED',
        key,
        contentType: checked.contentType,
        sizeBytes: checked.sizeBytes,
        sha256: checked.sha256,
        error: lastError,
        contentRunId: input.contentRunId ?? null,
        videoJobId: input.videoJobId ?? null,
      },
    })
    .catch(() => undefined);
  return { ok: false, error: `Upload failed after ${attempts} attempts: ${lastError}` };
}
