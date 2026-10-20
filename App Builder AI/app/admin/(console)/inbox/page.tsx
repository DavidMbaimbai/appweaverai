import { PlatformKnowledgePanel } from '@/components/admin/inbox/platform-knowledge';
import { AdminPageHeader } from '@/components/admin/ui/primitives';
import { InboxView } from '@/components/app/inbox/inbox-view';
import { adminInboxOpAction } from '@/lib/admin/actions/inbox';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { loadInboxPageData } from '@/lib/messaging/view';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ status?: string; channel?: string; q?: string; c?: string }> };

export default async function AdminInboxPage({ searchParams }: Props) {
  const auth = await requireAdmin('inbox:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'inbox:write');

  const [data, knowledge] = await Promise.all([
    loadInboxPageData({ type: 'PLATFORM' }, await searchParams),
    prisma.platformKnowledge.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, title: true, content: true } }),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Unified inbox"
        description="AppWeaver conversations across web, email, WhatsApp, SMS, Messenger and Instagram. Reviews and sensitive topics are never auto-answered."
      />
      <InboxView
        baseHref="/admin/inbox"
        threads={data.threads}
        selected={data.selected}
        filters={data.filters}
        statuses={data.statuses}
        canWrite={canWrite}
        onOp={adminInboxOpAction}
      />
      <PlatformKnowledgePanel entries={knowledge} canWrite={canWrite} />
    </div>
  );
}
