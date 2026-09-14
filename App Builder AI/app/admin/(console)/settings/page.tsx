import { AdminPageHeader } from '@/components/admin/ui/primitives';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth/require-admin';
import { hasPermission } from '@/lib/admin/permissions';
import { SettingField } from '@/components/admin/settings/setting-field';

const SETTINGS: Array<{
  key: string;
  label: string;
  description: string;
  type: 'number';
  defaultValue: number;
}> = [
  {
    key: 'security.admin_session_timeout_minutes',
    label: 'Admin session timeout (minutes)',
    description:
      'Admin sessions expire after this many minutes of inactivity (ADM-003).',
    type: 'number',
    defaultValue: 30,
  },
  {
    key: 'ai.daily_cost_alert_threshold_cents',
    label: 'Daily AI cost alert threshold (cents)',
    description: 'Used as a reference threshold for AI spend monitoring.',
    type: 'number',
    defaultValue: 10000,
  },
];

export default async function AdminSettingsPage() {
  const auth = await requireAdmin('settings:read');
  if (!auth.ok) return null;

  const stored = await prisma.adminSetting.findMany({
    where: { key: { in: SETTINGS.map((s) => s.key) } },
  });
  const storedMap = new Map(stored.map((s) => [s.key, s.value]));
  const canWrite = hasPermission(auth.admin.adminRole, 'settings:write');

  return (
    <div>
      <AdminPageHeader
        title="Settings"
        description="Centralized, audited operational configuration."
      />

      <div className="space-y-4">
        {SETTINGS.map((setting) => (
          <SettingField
            key={setting.key}
            settingKey={setting.key}
            label={setting.label}
            description={setting.description}
            defaultValue={
              (storedMap.get(setting.key) as number | undefined) ??
              setting.defaultValue
            }
            readOnly={!canWrite}
          />
        ))}
      </div>
    </div>
  );
}
