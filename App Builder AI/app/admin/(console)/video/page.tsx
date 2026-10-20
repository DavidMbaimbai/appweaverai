import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatCurrencyCents,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { VideoProviderForm } from '@/components/admin/video/video-provider-form';
import { hasPermission } from '@/lib/admin/permissions';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/prisma';
import { getProviderSettings, providerUsage } from '@/lib/video/jobs';
import { listVideoProviders } from '@/lib/video/providers/registry';

export const dynamic = 'force-dynamic';

export default async function AdminVideoPage() {
  const auth = await requireAdmin('video:read');
  if (!auth.ok) return null;
  const canWrite = hasPermission(auth.admin.adminRole, 'video:write');

  const providers = await Promise.all(
    listVideoProviders().map(async (provider) => ({
      provider,
      settings: await getProviderSettings(provider),
      usage: await providerUsage(provider.id),
      configured: provider.isConfigured(),
    })),
  );
  const failures = await prisma.videoJob.findMany({
    where: { status: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: { id: true, providerId: true, error: true, updatedAt: true },
  });

  return (
    <>
      <AdminPageHeader
        title="Video generation"
        description="Enable providers and set cost limits. Nothing is generated until a provider is enabled and configured."
      />
      <div className="space-y-8">
        {providers.map(({ provider, settings, usage, configured }) => (
          <section key={provider.id} className="space-y-4 rounded-xl border border-app-border-subtle bg-app-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-medium text-app-text">{provider.label}</h2>
              <StatusPill tone={settings.enabled ? 'success' : 'neutral'}>
                {settings.enabled ? 'Enabled' : 'Disabled'}
              </StatusPill>
              <StatusPill tone={configured.ok ? 'success' : 'danger'}>
                {configured.ok ? 'Configured' : configured.reason}
              </StatusPill>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiCard label="Videos today" value={String(usage.jobsToday)} hint={`limit ${settings.dailyJobLimit}`} />
              <KpiCard
                label="Spend this month"
                value={formatCurrencyCents(usage.spentThisMonthCents)}
                hint={`budget ${formatCurrencyCents(settings.monthlyBudgetCents)}`}
              />
              <KpiCard label="Longest clip" value={`${provider.capabilities.maxSeconds}s`} hint="provider limit" />
            </div>
            <VideoProviderForm
              providerId={provider.id}
              initial={settings}
              maxProviderSeconds={provider.capabilities.maxSeconds}
              canWrite={canWrite}
            />
          </section>
        ))}

        <section>
          <h2 className="mb-3 text-sm font-medium text-app-text">Recent failures</h2>
          {failures.length === 0 ? (
            <AdminEmptyState message="No failed video jobs." />
          ) : (
            <ul className="space-y-2 text-sm text-app-text-secondary">
              {failures.map((job) => (
                <li key={job.id} className="rounded-lg border border-app-border-subtle p-3">
                  <span className="text-app-text">{job.providerId}</span> · {formatDateTime(job.updatedAt)} ·{' '}
                  {job.error ?? 'No message'}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
