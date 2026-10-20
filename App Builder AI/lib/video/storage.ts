import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Presigned playback/download links live this long. */
export const VIDEO_URL_TTL_SECONDS = 300;

export function getVideoStorageConfig():
  | { ok: true; bucket: string; region: string }
  | { ok: false; reason: string } {
  const bucket = process.env.VIDEO_S3_BUCKET?.trim() || process.env.MARKETING_S3_BUCKET?.trim();
  if (!bucket) {
    return { ok: false, reason: 'Video storage is not configured (set VIDEO_S3_BUCKET).' };
  }
  return {
    ok: true,
    bucket,
    region: process.env.VIDEO_S3_REGION?.trim() || process.env.VIDEO_BEDROCK_REGION?.trim() || 'us-east-1',
  };
}

let client: S3Client | undefined;
let clientRegion: string | undefined;

function s3(region: string) {
  if (!client || clientRegion !== region) {
    client = new S3Client({ region });
    clientRegion = region;
  }
  return client;
}

function requireConfig() {
  const config = getVideoStorageConfig();
  if (!config.ok) throw new Error(config.reason);
  return config;
}

export async function headVideoObject(key: string): Promise<boolean> {
  const { bucket, region } = requireConfig();
  try {
    await s3(region).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

export async function putVideoObject(key: string, body: Buffer, contentType: string) {
  const { bucket, region } = requireConfig();
  await s3(region).send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getVideoObjectBytes(key: string): Promise<Buffer> {
  const { bucket, region } = requireConfig();
  const response = await s3(region).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error('Stored object is empty.');
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function presignVideoUrl(
  key: string,
  options: { download?: boolean; filename?: string } = {},
): Promise<string> {
  const { bucket, region } = requireConfig();
  return getSignedUrl(
    s3(region),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: key.endsWith('.mp4') ? 'video/mp4' : undefined,
      ResponseContentDisposition: options.download
        ? `attachment; filename="${(options.filename ?? 'video.mp4').replace(/[^\w.-]/g, '_')}"`
        : 'inline',
    }),
    { expiresIn: VIDEO_URL_TTL_SECONDS },
  );
}
