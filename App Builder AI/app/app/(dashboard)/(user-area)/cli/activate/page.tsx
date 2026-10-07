import { redirect } from 'next/navigation';

import { getCachedSession } from '@/lib/auth/cached';
import { CliActivateClient } from '@/components/app/cli/cli-activate-client';

export default async function CliActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const session = await getCachedSession();
  if (!session?.user?.id) {
    redirect('/?auth=login&callbackUrl=/app/cli/activate');
  }

  const { user_code } = await searchParams;

  return <CliActivateClient initialUserCode={user_code ?? ''} />;
}
