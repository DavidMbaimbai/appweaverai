import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import {
  InteractionReviewPanel,
  LeadReviewPanel,
} from '@/components/admin/outreach/outreach-panels';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { withFooter } from '@/lib/outreach/compliance';
import { prisma } from '@/lib/prisma';
import { REVIEW_NOTE } from '@/lib/support-inbox/filters';

export const dynamic = 'force-dynamic';

function footerFor(email: string | null) {
  const address = process.env.OUTREACH_POSTAL_ADDRESS?.trim();
  if (!address || !email) return null;
  try {
    // Show only the appended part, i.e. what follows the editable body.
    const text = withFooter({ body: '', email, postalAddress: address }).text;
    return text.trimStart();
  } catch {
    return null;
  }
}

function dayAgo() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

export default async function AdminOutreachPage() {
  const auth = await requireAdmin('outreach:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'outreach:write');

  const [interactions, leads, callList, sentToday, failedReplies, reviews, ads] = await Promise.all([
    prisma.socialInteraction.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.investorLead.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.investorLead.findMany({
      where: { phone: { not: null }, status: { notIn: ['DO_NOT_CONTACT', 'REJECTED'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.investorLead.count({
      where: { status: 'SENT', sentAt: { gte: dayAgo() } },
    }),
    prisma.socialInteraction.count({ where: { status: 'FAILED' } }),
    prisma.socialInteraction.findMany({
      where: { note: REVIEW_NOTE },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.adCreative.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);

  const adIds = ads.map((ad) => ad.id);
  const attributions = adIds.length
    ? await prisma.adAttribution.findMany({
        where: { content: { in: adIds } },
        select: { userId: true, content: true },
      })
    : [];
  const paidUsers = attributions.length
    ? await prisma.user.findMany({
        where: { id: { in: attributions.map((a) => a.userId) }, subscriptionPlan: { not: 'free' } },
        select: { id: true },
      })
    : [];
  const paidIds = new Set(paidUsers.map((u) => u.id));
  const adResults = ads.map((ad) => {
    const mine = attributions.filter((a) => a.content === ad.id);
    return { ...ad, signups: mine.length, paid: mine.filter((a) => paidIds.has(a.userId)).length };
  });

  return (
    <div>
      <AdminPageHeader
        title="Outreach"
        description="Approve social replies to investors and investor emails before anything is sent."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Replies awaiting approval" value={String(interactions.length - failedReplies)} />
        <KpiCard label="Failed sends" value={String(failedReplies)} />
        <KpiCard label="Emails awaiting approval" value={String(leads.length)} />
        <KpiCard label="Emails sent (24h)" value={String(sentToday)} />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-app-text">Social replies</h2>
        {interactions.length === 0 ? <AdminEmptyState message="No replies waiting." /> : null}
        <div className="space-y-3">
          {interactions.map((item) => (
            <div key={item.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-app-text">
                  {item.platform} · @{item.authorHandle}
                </p>
                <div className="flex items-center gap-2">
                  {item.audience ? <StatusPill tone="warning">{item.audience}</StatusPill> : null}
                  <StatusPill tone={item.status === 'FAILED' ? 'danger' : 'neutral'}>{item.status}</StatusPill>
                  <span className="text-xs text-app-text-muted">{formatDateTime(item.createdAt)}</span>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm text-app-text-secondary">{item.text}</p>
              {item.note ? <p className="mt-1 text-xs text-app-text-muted">Note: {item.note}</p> : null}
              <InteractionReviewPanel id={item.id} initialReply={item.reply ?? ''} canWrite={canWrite} />
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-app-text">Investor emails</h2>
        {leads.length === 0 ? <AdminEmptyState message="No emails waiting." /> : null}
        <div className="space-y-3">
          {leads.map((lead) => (
            <div key={lead.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
              <p className="text-sm font-medium text-app-text">
                {lead.name}
                {lead.firm ? ` · ${lead.firm}` : ''}
              </p>
              <p className="text-xs text-app-text-muted">
                {lead.email} · <a className="underline" href={lead.sourceUrl} target="_blank" rel="noreferrer noopener">source</a>
              </p>
              {lead.focus ? <p className="mt-1 text-xs text-app-text-secondary">Focus: {lead.focus}</p> : null}
              {lead.note ? <p className="mt-1 text-xs text-app-text-muted">Note: {lead.note}</p> : null}
              <LeadReviewPanel
                id={lead.id}
                initialSubject={lead.subject ?? ''}
                initialBody={lead.body ?? ''}
                footerPreview={footerFor(lead.email)}
                canWrite={canWrite}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-app-text">User reviews (human replies only, AI never answers)</h2>
        {reviews.length === 0 ? <AdminEmptyState message="No reviews." /> : null}
        <div className="space-y-3">
          {reviews.map((item) => (
            <div key={item.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
              <p className="text-sm font-medium text-app-text">
                {item.platform} · @{item.authorHandle}{' '}
                <span className="text-xs font-normal text-app-text-muted">{formatDateTime(item.createdAt)}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-app-text-secondary">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-app-text">Paid ads (automatic, USD 5/day cap)</h2>
        {adResults.length === 0 ? <AdminEmptyState message="No ads launched yet." /> : null}
        <div className="space-y-3">
          {adResults.map((ad) => (
            <div key={ad.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
              <p className="text-sm font-medium text-app-text">
                {ad.headline}{' '}
                <StatusPill tone={ad.status === 'FAILED' ? 'danger' : 'neutral'}>{ad.status}</StatusPill>
              </p>
              <p className="mt-1 text-sm text-app-text-secondary">{ad.primaryText}</p>
              <p className="mt-1 text-xs text-app-text-muted">
                Spend ${(ad.spendCents / 100).toFixed(2)} · {ad.impressions} views · {ad.clicks} clicks ·{' '}
                {ad.signups} sign-ups · {ad.paid} paying
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-app-text">Call list (dial these yourself)</h2>
        {callList.length === 0 ? <AdminEmptyState message="No leads with a published phone number." /> : null}
        <div className="space-y-3">
          {callList.map((lead) => (
            <div key={lead.id} className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
              <p className="text-sm font-medium text-app-text">
                {lead.name}
                {lead.firm ? ` · ${lead.firm}` : ''} · {lead.phone}
              </p>
              {lead.talkingPoints ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-app-text-secondary">{lead.talkingPoints}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
