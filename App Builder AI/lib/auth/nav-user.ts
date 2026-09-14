import type { AuthNavUser } from '../types/account';
import { prisma } from '../prisma';
import { getCachedSession } from './cached';

/**
 * Resolves the user identity shown in the public marketing site's navbar
 * (Navbar -> AuthNavActions). Admin Console accounts sign in through a
 * separate flow (/admin/login) but share the same underlying auth session,
 * so without this check an authenticated admin would appear "signed in" on
 * the public marketing pages too (showing their name and a link into /app).
 * Admin accounts aren't customers, so the marketing nav should keep showing
 * the normal "Log in" / "Create account" buttons for them, exactly as it
 * does for a signed-out visitor.
 */
export async function getMarketingNavUser(): Promise<AuthNavUser | null> {
  const session = await getCachedSession();

  if (!session?.user) {
    return null;
  }

  if (process.env.DATABASE_URL) {
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { adminRole: true },
    });

    if (dbUser?.adminRole) {
      return null;
    }
  }

  return { name: session.user.name, email: session.user.email };
}
