import {
  AdminPageHeader,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { AiLimitSettingsForm } from '@/components/admin/ai-usage/ai-limit-settings-form';
import { AiUsageNav } from '@/components/admin/ai-usage/ai-usage-nav';
import { hasPermission } from '@/lib/admin/permissions';
import { getAiUsageLimitSettings } from '@/lib/admin/queries/ai-usage';
import { requireAdmin } from '@/lib/auth/require-admin';

export default async function Page() {
  const auth = await requireAdmin('ai_usage:read');
  if (!auth.ok) return null;

  const settings = await getAiUsageLimitSettings();
  const canWrite = hasPermission(auth.admin.adminRole, 'ai_usage:write');
  const lastUpdated = settings
    .map((setting) => setting.updatedAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div>
      <AdminPageHeader
        title="AI usage limits"
        description={
          lastUpdated
            ? `Plan-level guardrails. Last updated ${formatDateTime(lastUpdated)}.`
            : 'Plan-level guardrails for AI request, token, and monthly cost caps.'
        }
      />

      <AiUsageNav active="limits" />

      <div className="mb-6 rounded-xl border border-app-border-subtle bg-app-surface p-4">
        <p className="text-sm text-app-text-secondary">
          Configure default limits per subscription plan. Release 1 stores and
          audits these settings; request-blocking enforcement is wired in a
          separate follow-up.
        </p>
        {!canWrite ? (
          <p className="mt-2 text-xs text-app-text-muted">
            You have read access to this configuration, but only admins with
            <span className="font-mono"> ai_usage:write </span>
            can update it.
          </p>
        ) : null}
      </div>

      <AiLimitSettingsForm
        settings={settings.map((setting) => ({
          plan: setting.plan,
          value: setting.value,
        }))}
        readOnly={!canWrite}
      />
    </div>
  );
}
