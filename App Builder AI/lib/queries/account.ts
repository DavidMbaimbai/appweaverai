import { prisma } from '@/lib/prisma';
import type { AccountProfile } from '@/lib/types/account';

export async function getAccountProfile(
  userId: string,
): Promise<AccountProfile | null> {
  if (!process.env.DATABASE_URL) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      image: true,
      emailVerified: true,
      createdAt: true,
      accounts: {
        select: {
          providerId: true,
          accountId: true,
        },
        orderBy: { providerId: 'asc' },
      },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    image: user.image,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
    connectedAccounts: user.accounts.map((account) => ({
      provider: account.providerId,
      providerAccountId: account.accountId,
    })),
  };
}
