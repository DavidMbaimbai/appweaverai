import { PageHeader } from '@/components/app/shell/page-header';
import { PrivacyPanel } from '@/components/privacy/privacy-panel';
import { getCachedSession } from '@/lib/auth/cached';
import { listUserExports } from '@/lib/privacy/export';
import { getDeletionStatus } from '@/lib/privacy/user-erasure';

export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  const userId = (await getCachedSession())?.user?.id;
  const ready = userId && process.env.DATABASE_URL;
  const [exports, deletion] = ready ? await Promise.all([listUserExports(userId), getDeletionStatus(userId)]) : [[], { status: 'NONE' as const }];

  return (
    <main className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader title="Privacy & data" />
      <div className="mx-auto w-full max-w-app-content flex-1 px-4 py-6 tablet-up:px-8">
        {ready ? <PrivacyPanel exports={exports} deletion={deletion} /> : <p className="text-sm text-app-text-muted">Sign in to manage your data.</p>}
      </div>
    </main>
  );
}
