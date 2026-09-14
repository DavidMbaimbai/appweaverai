'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { updateAdminSettingAction } from '@/lib/admin/actions/settings';

export function SettingField({
  settingKey,
  label,
  description,
  defaultValue,
  readOnly,
}: {
  settingKey: string;
  label: string;
  description: string;
  defaultValue: number;
  readOnly: boolean;
}) {
  const [value, setValue] = useState(String(defaultValue));
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="text-sm font-medium text-app-text">{label}</h2>
      <p className="mt-1 text-xs text-app-text-muted">{description}</p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          theme="app"
          type="number"
          className="w-40"
          value={value}
          disabled={readOnly}
          onChange={(e) => setValue(e.target.value)}
        />
        {!readOnly ? (
          <Button
            type="button"
            size="sm"
            theme="app"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) {
                  toast.error('Enter a valid number.');
                  return;
                }
                const result = await updateAdminSettingAction(
                  settingKey,
                  numeric,
                );
                if ('error' in result) toast.error(result.error);
                else toast.success('Setting saved.');
              })
            }>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
