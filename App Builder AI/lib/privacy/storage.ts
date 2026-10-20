import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { getVideoStorageConfig } from '@/lib/video/storage';

let client: S3Client | undefined;
let clientRegion: string | undefined;

function s3(region: string) {
  if (!client || clientRegion !== region) {
    client = new S3Client({ region });
    clientRegion = region;
  }
  return client;
}

export const privacyStorageConfigured = () => getVideoStorageConfig().ok;

export async function putPrivateObject(key: string, body: Buffer, contentType: string) {
  const config = getVideoStorageConfig();
  if (!config.ok) throw new Error(config.reason);
  await s3(config.region).send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getPrivateObject(key: string): Promise<Buffer> {
  const config = getVideoStorageConfig();
  if (!config.ok) throw new Error(config.reason);
  const response = await s3(config.region).send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (!response.Body) throw new Error('Stored object is empty.');
  return Buffer.from(await response.Body.transformToByteArray());
}

/** Deletes objects (a missing key is not an error). Throws on any per-key failure so the caller can retry. */
export async function deleteObjects(keys: string[]) {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return;
  const config = getVideoStorageConfig();
  if (!config.ok) throw new Error(config.reason);
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000);
    const result = await s3(config.region).send(
      new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
    );
    if (result.Errors?.length) {
      throw new Error(`Failed to delete ${result.Errors.length} stored object(s): ${result.Errors[0]?.Code ?? 'unknown'}`);
    }
  }
}
