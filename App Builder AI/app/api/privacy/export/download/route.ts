import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { exportJsonFromZip, loadExportBytes, verifyDownloadToken } from '@/lib/privacy/export';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const limited = await rateLimit(`privacy-download:${session.user.id}`, 20, 3_600_000);
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const url = new URL(request.url);
  const jobId = verifyDownloadToken(url.searchParams.get('token') ?? '');
  if (!jobId) return NextResponse.json({ error: 'This download link is invalid or has expired.' }, { status: 403 });

  const job = await prisma.privacyExportJob.findFirst({ where: { id: jobId, userId: session.user.id, status: 'READY' } });
  if (!job || (job.expiresAt && job.expiresAt < new Date())) return NextResponse.json({ error: 'Export not found or expired.' }, { status: 404 });
  const bytes = await loadExportBytes(job);
  if (!bytes) return NextResponse.json({ error: 'Export file is no longer available.' }, { status: 404 });

  await prisma.privacyExportJob.update({ where: { id: job.id }, data: { downloadCount: { increment: 1 } } });
  const json = url.searchParams.get('format') === 'json';
  const body = json ? exportJsonFromZip(bytes) : bytes;
  if (!body) return NextResponse.json({ error: 'Export file is no longer available.' }, { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': json ? 'application/json' : 'application/zip',
      'content-disposition': `attachment; filename="account-export.${json ? 'json' : 'zip'}"`,
      'cache-control': 'private, no-store',
    },
  });
}
