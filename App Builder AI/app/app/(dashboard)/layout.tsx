import { AppShell } from '@/components/app/shell/app-shell';
import { getCachedSession, getCachedUserWorkspaces } from '@/lib/auth/cached';

export default async function AppDashbaordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCachedSession();

  let workspaces: Awaited<ReturnType<typeof getCachedUserWorkspaces>> = [];

  if (session?.user?.id && process.env.DATABASE_URL) {
    workspaces = await getCachedUserWorkspaces(session.user.id);
  }

  return (
    <AppShell
      workspaces={workspaces}
      user={{
        name: session?.user?.name ?? 'Guest',
        email: session?.user?.email ?? null,
        image: session?.user?.image ?? null,
      }}>
      {children}
    </AppShell>
  );
}
