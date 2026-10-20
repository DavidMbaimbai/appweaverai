import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { auth } from '@/lib/auth';
import { getPublishedProjectBySlugs } from '@/lib/queries/published';
import { recordPageView } from '@/lib/analytics/record-page-view';
import { attributionFromSearch } from '@/lib/ads/attribution-cookie';
import { PublishedProjectViewer } from '@/components/app/published/published-project-viewer';

type PublishedPageProps = {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: PublishedPageProps): Promise<Metadata> {
  const { workspaceSlug, projectSlug } = await params;
  const result = await getPublishedProjectBySlugs(workspaceSlug, projectSlug);

  if (!result || 'forbidden' in result) {
    return {};
  }

  const title = result.seo.title || result.name;
  const description = result.seo.description ?? undefined;
  const images = result.seo.imageUrl ? [{ url: result.seo.imageUrl }] : undefined;

  return {
    title,
    description,
    icons: result.seo.faviconUrl ? { icon: result.seo.faviconUrl } : undefined,
    openGraph: {
      title,
      description,
      images,
      type: 'website',
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title,
      description,
      images,
    },
  };
}

export default async function PublishedProjectPage({
  params,
  searchParams,
}: PublishedPageProps) {
  const { workspaceSlug, projectSlug } = await params;
  const query = (await searchParams) ?? {};
  const utmParams = new URLSearchParams();
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    const value = query[key];
    if (typeof value === 'string') utmParams.set(key, value);
  }
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
    utm: attributionFromSearch(utmParams),
    ip:
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerList.get('x-real-ip'),
    userAgent: headerList.get('user-agent'),
  });

  return <PublishedProjectViewer project={result} />;
}
