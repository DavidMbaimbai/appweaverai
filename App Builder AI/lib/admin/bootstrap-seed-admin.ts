import { hashPassword } from 'better-auth/crypto';
import { prisma } from '@/lib/prisma';
import { provisionNewUser } from '@/lib/auth/provision-user';
import type { AdminRole } from '@/lib/generated/prisma/client';

const VALID_ROLES: AdminRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCE_ADMIN',
  'SUPPORT_ADMIN',
  'ANALYTICS_VIEWER',
  'SECURITY_ADMIN',
];

let hasAttempted = false;

/**
 * Auto-provisions the Admin Console's first admin account from environment
 * variables — no CLI/seed script and no public sign-up flow required. Set
 * `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` (optionally `ADMIN_SEED_ROLE`,
 * default SUPER_ADMIN) and simply visit /admin/login — this runs
 * automatically on the next admin request.
 *
 * The account is created directly via Prisma (User + a "credential" Account
 * row with a hashed password, matching exactly what better-auth's own
 * sign-in/email flow expects to verify against) rather than through
 * better-auth's sign-up API — the admin area is login-only, there is no
 * public sign-up endpoint (`emailAndPassword.disableSignUp: true` in
 * lib/auth.ts blocks it outright).
 *
 * Idempotent and best-effort: runs at most once per server process, never
 * throws (a failure here must not break the admin login page), and does
 * nothing once the target account already has the requested admin role.
 */
export async function ensureSeedAdminAccount(): Promise<void> {
  if (hasAttempted) return;
  hasAttempted = true;

  const email = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD;
  const roleInput = (process.env.ADMIN_SEED_ROLE ?? 'SUPER_ADMIN')
    .trim()
    .toUpperCase();

  if (!email || !password || !process.env.DATABASE_URL) return;

  const role = VALID_ROLES.includes(roleInput as AdminRole)
    ? (roleInput as AdminRole)
    : 'SUPER_ADMIN';

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.adminRole === role && existing.accountStatus === 'ACTIVE') {
        return;
      }

      await prisma.user.update({
        where: { email },
        data: {
          adminRole: role,
          accountStatus: 'ACTIVE',
          emailVerified: true,
        },
      });
      return;
    }

    const passwordHash = await hashPassword(password);

    const created = await prisma.user.create({
      data: {
        email,
        name: email.split('@')[0],
        emailVerified: true,
        adminRole: role,
        accountStatus: 'ACTIVE',
      },
    });

    await prisma.account.create({
      data: {
        userId: created.id,
        accountId: created.id,
        providerId: 'credential',
        password: passwordHash,
      },
    });

    await provisionNewUser({
      id: created.id,
      name: created.name,
      email: created.email,
      username: null,
    });
  } catch (error) {
    console.error('[admin] failed to auto-provision seed admin account', error);
  }
}
