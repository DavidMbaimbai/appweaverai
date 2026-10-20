import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { auth } from '@/lib/auth';
import { authorizeStagingAccess } from '@/lib/hosting/staging';
import {
  STAGING_TOKEN_PARAM,
  stagingCookieName,
} from '@/lib/hosting/staging-core';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Staging preview',
  robots: { index: false, follow: false, nocache: true },
};

type StagingPageProps = {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
  searchParams: Promise<{ [STAGING_TOKEN_PARAM]?: string }>;
};

/** Path-based staging page; the host-based `<slug>--staging.<root>` rewrites here. */
export default async function StagingPage({ params, searchParams }: StagingPageProps) {
  const { workspaceSlug, projectSlug } = await params;
  const { token } = await searchParams;

  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      deletedAt: null,
      workspace: { slug: workspaceSlug },
    },
    select: {
      id: true,
      name: true,
      artifacts: { orderBy: { sortOrder: 'asc' }, take: 1, select: { slug: true } },
    },
  });
  if (!project) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  const cookieToken = (await cookies()).get(stagingCookieName(project.id))?.value;
  const access = await authorizeStagingAccess(project.id, session?.user?.id ?? null, {
    query: token,
    cookie: cookieToken,
  });
  if (!access.allowed) notFound();

  const artifactSlug = project.artifacts[0]?.slug ?? 'main';
  const src = `/api/projects/${project.id}/staging/${artifactSlug}${
    token ? `?${STAGING_TOKEN_PARAM}=${encodeURIComponent(token)}` : ''
  }`;

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="text-sm font-medium">{project.name}</p>
        <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-xs font-medium text-amber-300">
          Staging preview · not public
        </span>
      </header>
      <iframe
        title={`${project.name} (staging)`}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-forms"
        className="h-full w-full border-0"
      />
    </div>
  );
}
