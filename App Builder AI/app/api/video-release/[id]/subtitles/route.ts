import { NextResponse } from 'next/server';

import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { translateLines } from '@/lib/video-release/localize';
import { buildSrt } from '@/lib/video-release/subtitles';

/** SRT built only from the owner's scene text; 404-style message when there is none. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Database not configured.' }, { status: 500 });

  const limit = await rateLimit(`video-srt:${userId}`, 20, 60_000);
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const { id } = await context.params;
  const release = await prisma.videoRelease.findFirst({ where: { id, userId } });
  if (!release) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const scenes = release.sceneId
    ? await prisma.videoScene.findMany({ where: { id: release.sceneId, videoProject: { userId } }, select: { prompt: true, seconds: true } })
    : (await prisma.videoJob.findMany({ where: { id: release.jobId, userId }, select: { prompt: true, seconds: true } }));

  let translated: string[] | undefined;
  if (release.language !== 'en' && scenes.some((s) => s.prompt.trim())) {
    // Prompts are assumed to be in English; if translation is unavailable the original text is served and labelled.
    translated = (await translateLines(scenes.map((s) => s.prompt), release.language).catch(() => null)) ?? undefined;
  }
  const result = buildSrt(scenes, translated);
  if (!result.available) return NextResponse.json({ available: false, error: result.reason }, { status: 404 });

  return new NextResponse(result.srt, {
    headers: {
      'content-type': 'application/x-subrip; charset=utf-8',
      'content-disposition': `attachment; filename="subtitles-${release.language}.srt"`,
      'cache-control': 'private, no-store',
      'x-subtitle-note': result.note,
    },
  });
}
