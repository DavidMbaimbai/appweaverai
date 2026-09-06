'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { InlineEditField } from '../account/inline-edit-field';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';
import {
  updateUserSettingsAction,
  updateWorkspaceSlugAction,
} from '@/lib/actions/settings';
import {
  defaultStartPageOptions,
  type AppUserSettings,
} from '@/lib/types/settings';

type SettingsPageClientProps = {
  settings: AppUserSettings;
};

type SettingKey = Exclude<keyof AppUserSettings, 'workspaceSlug'>;

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-app-border bg-app-surface">
      <div className="border-b border-app-border-subtle px-6 py-5">
        <h2 className="font-display text-lg text-app-text">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-app-text-muted">{description}</p>
        ) : null}
      </div>
      <div className="px-6">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 border-b border-app-border-subtle py-4 last:border-b-0 tablet-up:grid-cols-2 tablet-up:items-center tablet-up:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-app-text">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs text-app-text-muted">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0 flex justify-end">{children}</div>
    </div>
  );
}

export function SettingsPageClient({
  settings: initial,
}: SettingsPageClientProps) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [settings, setSettings] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function updateSetting<K extends SettingKey>(
    key: K,
    value: AppUserSettings[K],
    savedMessage: string,
  ) {
    setSettings((current) => ({ ...current, [key]: value }));

    startTransition(async () => {
      const result = await updateUserSettingsAction({ [key]: value });

      if (result.error) {
        setSettings(initial);
        toastError(result.error);
        return;
      }

      success(savedMessage);
    });
  }

  return (
    <div className="w-full px-6 py-8 tablet-up:px-8">
      <div className="mb-8">
        <h1 className="font-display text-2xl text-app-text">Settings</h1>
        <p className="mt-1 text-sm text-app-text-muted">
          Preferences for your workspace, navigation, and the editor.
        </p>
      </div>

      <div className="space-y-6">
        <SettingsSection
          title="Workspace"
          description="Customize how your projects appear in the URL.">
          <InlineEditField
            id="settings-workspace-slug"
            label="Workspace URL"
            value={settings.workspaceSlug}
            placeholder="your-workspace"
            hint={`Project links look like /app/projects/${settings.workspaceSlug || 'your-workspace'}/project-name`}
            disabled={isPending}
            savedMessage="Workspace URL updated"
            onSave={async (value) => {
              const result = await updateWorkspaceSlugAction(value);

              if (result.error) {
                return { error: result.error };
              }

              const nextSlug = result.value ?? value;
              setSettings((current) => ({
                ...current,
                workspaceSlug: nextSlug,
              }));
              router.refresh();
              return { value: nextSlug };
            }}
          />
        </SettingsSection>

        <SettingsSection
          title="General"
          description="How the app behaves when you sign in.">
          <SettingsRow
            label="Default start page"
            description="Where you land after signing in.">
            <Select
              value={settings.defaultStartPage}
              disabled={isPending}
              theme="app"
              className="w-full"
              aria-label="Default start page"
              onChange={(event) =>
                updateSetting(
                  'defaultStartPage',
                  event.target.value as AppUserSettings['defaultStartPage'],
                  'Default start page updated',
                )
              }>
              {defaultStartPageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title="Editor"
          description="Customize your building experience.">
          <SettingsRow
            label="Keyboard shortcuts"
            description="Show shortcut hints in the command palette footer.">
            <Toggle
              label="Keyboard shortcuts"
              checked={settings.showShortcuts}
              disabled={isPending}
              onChange={(checked) =>
                updateSetting(
                  'showShortcuts',
                  checked,
                  'Shortcut preference saved',
                )
              }
            />
          </SettingsRow>
        </SettingsSection>
      </div>
    </div>
  );
}
