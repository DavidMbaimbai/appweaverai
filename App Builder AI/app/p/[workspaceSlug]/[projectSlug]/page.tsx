import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { getPublishedProjectBySlugs } from '@/lib/queries/published';
import { recordPageView } from '@/lib/analytics/record-page-view';
import { PublishedProjectViewer } from '@/components/app/published/published-project-viewer';

type PublishedPageProps = {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
};

export default async function PublishedProjectPage({
  params,
}: PublishedPageProps) {
  const { workspaceSlug, projectSlug } = await params;
  const headerList = await headers();
  const session = await auth.api.getSession({ headers: headerList });
  const userId = session?.user?.id ?? null;

  const result = await getPublishedProjectBySlugs(
    workspaceSlug,
    projectSlug,
    userId,
  );

  if (!result) {
    notFound();
  }

  if ('forbidden' in result) {
    if (!userId) {
      redirect(`/?auth=login&callbackUrl=/p/${workspaceSlug}/${projectSlug}`);
    }
    notFound();
  }

  await recordPageView({
    projectId: result.id,
    path: `/p/${workspaceSlug}/${projectSlug}`,
    referrer: headerList.get('referer'),
    ip:
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerList.get('x-real-ip'),
    userAgent: headerList.get('user-agent'),
  });

  return <PublishedProjectViewer project={result} />;
}
