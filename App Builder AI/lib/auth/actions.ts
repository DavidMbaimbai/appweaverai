'use server';

import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { recordEmailVerificationLocation } from '@/lib/auth/record-auth-activity';

async function getRequestIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

/**
 * Called from the sign-up modal (components/auth/auth-modal.tsx) right
 * after the 8-digit email verification code is accepted. Resolves the
 * caller's approximate location from their IP and records it for the
 * Admin Console's Audit Logs / Security Events, and for the "recent
 * verification locations" shown on the public footer globe and Analytics
 * page. Best-effort: silently no-ops if there's no active session.
 */
export async function recordEmailVerifiedAction() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user?.id) return;

  await recordEmailVerificationLocation({
    userId: session.user.id,
    ipAddress: await getRequestIp(),
  });
}
