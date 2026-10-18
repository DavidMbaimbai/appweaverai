import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasProjectAccess } from '@/lib/projects/access';
import {
  connectionEnvFromUrl,
  dropProjectDatabase,
  isManagedDatabaseConfigured,
  provisionProjectDatabase,
} from '@/lib/databases/provision';

type Context = { params: Promise<{ projectId: string }> };

const bodySchema = z.object({
  environment: z.enum(['DEVELOPMENT', 'PRODUCTION']),
  /** POST only: also return the connection env vars (e.g. for the AWS deploy). */
  reveal: z.boolean().optional(),
});

async function authorize(context: Context) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  const { projectId } = await context.params;
  if (!userId || !(await hasProjectAccess(projectId, userId))) return null;
  return projectId;
}

const unauthorized = () =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

export async function GET(_request: Request, context: Context) {
  const projectId = await authorize(context);
  if (!projectId) return unauthorized();

  const databases = await prisma.projectDatabase.findMany({
    where: { projectId },
    select: { environment: true, databaseName: true, host: true, isActive: true },
  });
  return NextResponse.json({
    configured: isManagedDatabaseConfigured(),
    databases,
  });
}

export async function POST(request: Request, context: Context) {
  const projectId = await authorize(context);
  if (!projectId) return unauthorized();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  try {
    const url = await provisionProjectDatabase(projectId, parsed.data.environment);
    return NextResponse.json({
      success: true,
      ...(parsed.data.reveal ? { env: connectionEnvFromUrl(url) } : {}),
    });
  } catch (error) {
    console.error('[database] provision failed:', error);
    return NextResponse.json(
      { error: 'Could not provision the database.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const projectId = await authorize(context);
  if (!projectId) return unauthorized();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  try {
    await dropProjectDatabase(projectId, parsed.data.environment);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[database] drop failed:', error);
    return NextResponse.json({ error: 'Could not delete the database.' }, { status: 500 });
  }
}
