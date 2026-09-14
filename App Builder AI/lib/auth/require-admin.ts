import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  ADMIN_PERMISSIONS,
  hasPermission,
  type AdminPermission,
} from '@/lib/admin/permissions';
import { ensureSeedAdminAccount } from '@/lib/admin/bootstrap-seed-admin';
import type { AdminRole } from '@/lib/generated/prisma/client';

export type AdminSessionUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  adminRole: AdminRole;
};

type RequireAdminResult =
  | { ok: true; admin: AdminSessionUser }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'no_database' };

/**
 * Server-side authorization guard for the Admin Console (ADM-001, ADM-002).
 * This MUST be called by every admin route/server action — the admin nav is
 * only an optimistic UI affordance, not a security boundary.
 */
export async function requireAdmin(
  permission?: AdminPermission,
): Promise<RequireAdminResult> {
  if (!process.env.DATABASE_URL) {
    return { ok: false, reason: 'no_database' };
  }

  // No-op unless ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD are set; auto-creates
  // or promotes that account so the very first admin never needs a CLI step.
  await ensureSeedAdminAccount();

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return { ok: false, reason: 'unauthenticated' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      adminRole: true,
      accountStatus: true,
    },
  });

  if (!user?.adminRole || user.accountStatus !== 'ACTIVE') {
    return { ok: false, reason: 'forbidden' };
  }

  if (permission && !hasPermission(user.adminRole, permission)) {
    return { ok: false, reason: 'forbidden' };
  }

  return {
    ok: true,
    admin: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      adminRole: user.adminRole,
    },
  };
}

/** Throws-free helper for permission checks inside already-authenticated admin server actions. */
export function assertPermission(
  role: AdminRole | null | undefined,
  permission: AdminPermission,
) {
  if (!hasPermission(role, permission)) {
    throw new Error(`Missing admin permission: ${permission}`);
  }
}

export { ADMIN_PERMISSIONS };
