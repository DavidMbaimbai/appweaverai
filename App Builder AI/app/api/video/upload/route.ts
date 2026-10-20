import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import sharp from 'sharp';

import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { getVideoStorageConfig, putVideoObject } from '@/lib/video/storage';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Attaches a reference image to one of the user's scenes (stored as 1280x720 PNG). */
export async function POST(request: Request) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });
  }
  const storage = getVideoStorageConfig();
  if (!storage.ok) return NextResponse.json({ error: storage.reason }, { status: 503 });

  const limit = await rateLimit(`video-upload:${userId}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many uploads. Try again shortly.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const sceneId = form?.get('sceneId');
  if (!(file instanceof File) || typeof sceneId !== 'string') {
    return NextResponse.json({ error: 'An image and scene are required.' }, { status: 400 });
  }
  if (!ALLOWED.has(file.type) || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Use a PNG, JPEG or WebP image up to 8 MB.' }, { status: 400 });
  }

  const scene = await prisma.videoScene.findFirst({
    where: { id: sceneId, videoProject: { userId } },
    select: { id: true },
  });
  if (!scene) return NextResponse.json({ error: 'Scene not found.' }, { status: 404 });

  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(1280, 720, { fit: 'cover' })
      .png()
      .toBuffer();
  } catch {
    return NextResponse.json({ error: 'That image could not be read.' }, { status: 400 });
  }

  const key = `video-inputs/${userId}/${randomUUID()}.png`;
  try {
    await putVideoObject(key, png, 'image/png');
  } catch (error) {
    console.error('[video] upload failed:', error);
    return NextResponse.json({ error: 'Video storage is unavailable.' }, { status: 503 });
  }
  await prisma.videoScene.update({ where: { id: scene.id }, data: { referenceImageKey: key } });
  return NextResponse.json({ ok: true });
}
