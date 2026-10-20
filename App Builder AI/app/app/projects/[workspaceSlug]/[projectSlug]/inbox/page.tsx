import { notFound } from 'next/navigation';

import { ConnectionsPanel } from '@/components/app/inbox/connections-panel';
import { InboxView } from '@/components/app/inbox/inbox-view';
import { inboxOpAction } from '@/lib/actions/inbox';
import { getCachedSession } from '@/lib/auth/cached';
import { loadInboxPageData } from '@/lib/messaging/view';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ workspaceSlug: string; projectSlug: string }>;
  searchParams: Promise<{ status?: string; channel?: string; q?: string; c?: string }>;
};

export default async function ProjectInboxPage({ params, searchParams }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      deletedAt: null,
      workspace: { slug: workspaceSlug },
      OR: [{ createdById: userId }, { workspace: { ownerId: userId } }],
    },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const data = await loadInboxPageData({ type: 'PROJECT', projectId: project.id }, await searchParams);
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const widgetSnippet = `<script src="${base}/api/messaging/webchat/widget" data-project-id="${project.id}" async></script>`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold text-app-text">Inbox · {project.name}</h1>
        <p className="text-sm text-app-text-muted">
          Customer conversations from every channel. Replies follow your Customer Engagement agent mode; refunds, legal, security and payment questions are always escalated to you.
        </p>
      </header>
      <InboxView
        baseHref={`/app/projects/${workspaceSlug}/${projectSlug}/inbox`}
        threads={data.threads}
        selected={data.selected}
        filters={data.filters}
        statuses={data.statuses}
        canWrite
        onOp={inboxOpAction.bind(null, project.id)}
      />
      <ConnectionsPanel projectId={project.id} widgetSnippet={widgetSnippet} />
    </div>
  );
}
