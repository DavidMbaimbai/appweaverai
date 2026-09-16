import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/shell/app-shell';
import { getCachedSession, getCachedUserWorkspaces } from '@/lib/auth/cached';
import { getSidebarBillingSummary } from '@/lib/queries/billing';
import { prisma } from '@/lib/prisma';

export default async function AppDashbaordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCachedSession();

  let workspaces: Awaited<ReturnType<typeof getCachedUserWorkspaces>> = [];
  let billing: Awaited<ReturnType<typeof getSidebarBillingSummary>> = null;

  if (session?.user?.id && process.env.DATABASE_URL) {
    // Admin Console accounts share the same auth session as regular
    // customers. If an admin ends up here (e.g. by signing in through the
    // customer Google/GitHub flow with their admin email), send them to the
    // Admin Console instead of the customer dashboard.
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { adminRole: true },
    });

    if (dbUser?.adminRole) {
      redirect('/admin');
    }

    workspaces = await getCachedUserWorkspaces(session.user.id);
    billing = await getSidebarBillingSummary(session.user.id);
  }

  return (
    <AppShell
      workspaces={workspaces}
      billing={billing}
      user={{
        name: session?.user?.name ?? 'Guest',
        email: session?.user?.email ?? null,
        image: session?.user?.image ?? null,
      }}>
      {children}
    </AppShell>
  );
}
