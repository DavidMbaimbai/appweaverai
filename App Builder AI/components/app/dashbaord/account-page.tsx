import { EmptyState } from '@/components/ui/empty-state';
import { getCachedSession } from '@/lib/auth/cached';
import { getAccountProfile } from '@/lib/queries/account';
import { redirect } from 'next/navigation';
import { AccountPageClient } from '../account/account-page-client';

export async function AccountPage() {
  const session = await getCachedSession();

  if (!session?.user?.id) {
    redirect('/?auth=login&callbackUrl=/app/account');
  }

  const profile = await getAccountProfile(session.user.id);

  if (!profile) {
    return (
      <div className="flex w-full flex-1 items-center justify-center px-6 py-8">
        <EmptyState
          theme="app"
          className="max-w-md"
          title="Account unavailable"
          description="Connect a database to load and edit your profile."
        />
      </div>
    );
  }

  return <AccountPageClient profile={profile} />;
}
