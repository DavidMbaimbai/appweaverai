import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  AdminPageHeader,
  StatusPill,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { SubscriptionActionsPanel } from '@/components/admin/subscriptions/subscription-actions-panel';
import { hasPermission } from '@/lib/admin/permissions';
import { getSubscriptionDetail } from '@/lib/admin/queries/subscriptions';
import { requireAdmin } from '@/lib/auth/require-admin';

export default async function AdminSubscriptionDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const auth = await requireAdmin('subscriptions:read');
  if (!auth.ok) return null;

  const { userId } = await params;
  const detail = await getSubscriptionDetail(userId);
  if (!detail) notFound();

  const canWrite = hasPermission(auth.admin.adminRole, 'subscriptions:write');
  const live = detail.liveSubscription;

  return (
    <div>
      <AdminPageHeader
        title={
          detail.user.name ||
          detail.user.username ||
          detail.user.email ||
          detail.user.id
        }
        description={detail.user.stripeSubscriptionId ?? 'Local subscription record'}
        actions={
          <StatusPill
            tone={
              detail.user.subscriptionPlan === 'pro'
                ? 'success'
                : detail.user.subscriptionPlan === 'free'
                  ? 'neutral'
                  : 'info'
            }>
            {detail.user.subscriptionPlan}
          </StatusPill>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Local subscription record">
            <Field label="User ID" value={detail.user.id} mono />
            <Field label="Email" value={detail.user.email ?? '—'} />
            <Field label="Account status" value={detail.user.accountStatus} />
            <Field label="Plan" value={detail.user.subscriptionPlan} />
            <Field
              label="Stored status"
              value={detail.user.subscriptionStatus ?? '—'}
            />
            <Field
              label="Stripe customer"
              value={detail.user.stripeCustomerId ?? '—'}
              mono
            />
            <Field
              label="Stripe subscription"
              value={detail.user.stripeSubscriptionId ?? '—'}
              mono
            />
            <Field label="Joined" value={formatDateTime(detail.user.createdAt)} />
            <div className="pt-2 text-sm">
              <Link
                href={`/admin/users/${detail.user.id}`}
                className="text-app-accent-blue hover:underline">
                View full user profile →
              </Link>
            </div>
          </Section>

          <Section title="Live Stripe subscription">
            {live ? (
              <div className="space-y-2">
                <Field label="Status" value={live.status} />
                <Field
                  label="Current period start"
                  value={
                    live.currentPeriodStart
                      ? formatDateTime(live.currentPeriodStart)
                      : '—'
                  }
                />
                <Field
                  label="Current period end"
                  value={
                    live.currentPeriodEnd
                      ? formatDateTime(live.currentPeriodEnd)
                      : '—'
                  }
                />
                <Field
                  label="Trial end"
                  value={live.trialEnd ? formatDateTime(live.trialEnd) : '—'}
                />
                <Field
                  label="Cancel at period end"
                  value={live.cancelAtPeriodEnd ? 'Yes' : 'No'}
                />
                <Field
                  label="Cancel at"
                  value={live.cancelAt ? formatDateTime(live.cancelAt) : '—'}
                />
              </div>
            ) : (
              <p className="text-sm text-app-text-muted">
                {detail.stripeConfigured
                  ? 'No live Stripe subscription is associated with this user.'
                  : 'Stripe is not configured, so live subscription details are unavailable.'}
              </p>
            )}
          </Section>

          <Section title="Subscription items">
            {live?.items.length ? (
              <ul className="space-y-2">
                {live.items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-app-border-subtle px-3 py-2 text-sm">
                    <p className="text-app-text">
                      {item.productName ?? 'Stripe product'}{' '}
                      {item.quantity ? `× ${item.quantity}` : ''}
                    </p>
                    <p className="mt-1 text-app-text-secondary">
                      {item.priceLabel ?? item.priceId}
                      {item.intervalLabel ? ` / ${item.intervalLabel}` : ''}
                    </p>
                    <p className="mt-1 font-mono text-xs text-app-text-muted">
                      {item.priceId}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-app-text-muted">
                No Stripe line items are available for this record.
              </p>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          {canWrite ? (
            <SubscriptionActionsPanel
              userId={detail.user.id}
              currentPlan={detail.user.subscriptionPlan}
              stripeConfigured={detail.stripeConfigured}
              hasStripeSubscription={Boolean(detail.user.stripeSubscriptionId)}
              trialEndIso={live?.trialEnd?.toISOString() ?? null}
            />
          ) : (
            <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
              <h2 className="mb-2 text-sm font-medium text-app-text">Actions</h2>
              <p className="text-sm text-app-text-muted">
                You do not have permission to modify subscriptions.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-app-text">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-app-text-muted">{label}</span>
      <span className={mono ? 'font-mono text-xs text-app-text' : 'text-app-text'}>
        {value}
      </span>
    </div>
  );
}
