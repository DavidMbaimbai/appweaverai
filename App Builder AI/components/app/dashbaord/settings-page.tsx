import { EmptyState } from '@/components/ui/empty-state';
import { getCachedSession, getCachedUserSettings } from '@/lib/auth/cached';
import { redirect } from 'next/navigation';
import { SettingsPageClient } from '../settings/settings-page-client';

export async function SettingsPage() {
  const session = await getCachedSession();

  if (!session?.user?.id) {
    redirect('/?auth=login&callbackUrl=/app/settings');
  }

  const settings = await getCachedUserSettings(session.user.id);

  if (!settings) {
    return (
      <div className="flex w-full flex-1 items-center justify-center px-6 py-8">
        <EmptyState
          theme="app"
          className="max-w-md"
          title="Settings unavailable"
          description="Connect a database to save your pererences."
        />
      </div>
    );
  }
  return <SettingsPageClient settings={settings} />;
}
