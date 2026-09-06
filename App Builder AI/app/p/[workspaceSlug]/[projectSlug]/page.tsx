import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { getPublishedProjectBySlugs } from '@/lib/queries/published';
import { PublishedProjectViewer } from '@/components/app/published/published-project-viewer';

type PublishedPageProps = {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
};

export default async function PublishedProjectPage({
  params,
}: PublishedPageProps) {
  const { workspaceSlug, projectSlug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
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

  return <PublishedProjectViewer project={result} />;
}
