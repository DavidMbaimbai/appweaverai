import { headers } from 'next/headers';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import {
  getUserBrandKit,
  saveUserBrandKit,
} from '@/lib/brand-kit/project-brand-kit';

const updateSchema = z.object({
  logoUrl: z.string().trim().max(2000).optional().nullable(),
  primaryColor: z.string().trim().max(32).optional().nullable(),
  secondaryColor: z.string().trim().max(32).optional().nullable(),
  accentColor: z.string().trim().max(32).optional().nullable(),
  fontFamily: z.string().trim().max(200).optional().nullable(),
});

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  return Response.json({ brandKit: await getUserBrandKit(userId) });
}

export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid brand kit values.' }, { status: 400 });
  }

  const brandKit = await saveUserBrandKit(userId, {
    logoUrl: parsed.data.logoUrl ?? null,
    primaryColor: parsed.data.primaryColor ?? null,
    secondaryColor: parsed.data.secondaryColor ?? null,
    accentColor: parsed.data.accentColor ?? null,
    fontFamily: parsed.data.fontFamily ?? null,
  });

  return Response.json({ success: true, brandKit });
}
