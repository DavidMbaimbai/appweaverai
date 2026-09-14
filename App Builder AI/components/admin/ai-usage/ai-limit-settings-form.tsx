'use client';

import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { upsertAiPlanLimitAction } from '@/lib/admin/actions/ai-limits';
import type {
  AiLimitPlan,
  AiLimitSettingValue,
} from '@/lib/admin/queries/ai-usage';

const PLAN_LABELS: Record<AiLimitPlan, string> = {
  free: 'Free plan',
  pro: 'Pro plan',
};

type PlanSetting = {
  plan: AiLimitPlan;
  value: AiLimitSettingValue;
};

type EditablePlanValues = Record<
  AiLimitPlan,
  Record<keyof AiLimitSettingValue, string>
>;

export function AiLimitSettingsForm({
  settings,
  readOnly,
}: {
  settings: PlanSetting[];
  readOnly: boolean;
}) {
  const initialValues = useMemo<EditablePlanValues>(
    () => ({
      free: toEditableValues(
        settings.find((setting) => setting.plan === 'free')?.value,
      ),
      pro: toEditableValues(
        settings.find((setting) => setting.plan === 'pro')?.value,
      ),
    }),
    [settings],
  );
  const [values, setValues] = useState(initialValues);
  const [savingPlan, setSavingPlan] = useState<AiLimitPlan | null>(null);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function updateValue(
    plan: AiLimitPlan,
    field: keyof AiLimitSettingValue,
    nextValue: string,
  ) {
    setValues((current) => ({
      ...current,
      [plan]: {
        ...current[plan],
        [field]: nextValue,
      },
    }));
  }

  function savePlan(plan: AiLimitPlan) {
    startTransition(async () => {
      setSavingPlan(plan);
      const parsed = parseEditableValues(values[plan]);

      if (!parsed.ok) {
        toast.error(parsed.error);
        setSavingPlan(null);
        return;
      }

      const result = await upsertAiPlanLimitAction(plan, parsed.value);
      if ('error' in result) {
        toast.error(result.error);
      } else {
        toast.success(`${PLAN_LABELS[plan]} limits saved.`);
      }

      setSavingPlan(null);
    });
  }

  return (
    <div className="space-y-4">
      {settings.map((setting) => {
        const currentValues = values[setting.plan];
        const planIsPending = isPending && savingPlan === setting.plan;

        return (
          <div
            key={setting.plan}
            className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-app-text">
                  {PLAN_LABELS[setting.plan]}
                </h2>
                <p className="mt-1 text-xs text-app-text-muted">
                  Default caps stored in AdminSetting. Enforcement wiring for
                  per-user overrides is a separate follow-up outside ADM-064.
                </p>
              </div>

              {!readOnly ? (
                <Button
                  type="button"
                  size="sm"
                  theme="app"
                  disabled={planIsPending}
                  onClick={() => savePlan(setting.plan)}>
                  {planIsPending ? 'Saving...' : 'Save plan limits'}
                </Button>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field
                label="Daily request limit"
                value={currentValues.dailyRequestLimit}
                disabled={readOnly || planIsPending}
                onChange={(next) =>
                  updateValue(setting.plan, 'dailyRequestLimit', next)
                }
              />
              <Field
                label="Daily token limit"
                value={currentValues.dailyTokenLimit}
                disabled={readOnly || planIsPending}
                onChange={(next) =>
                  updateValue(setting.plan, 'dailyTokenLimit', next)
                }
              />
              <Field
                label="Monthly cost cap (cents)"
                value={currentValues.monthlyCostCentsLimit}
                disabled={readOnly || planIsPending}
                onChange={(next) =>
                  updateValue(setting.plan, 'monthlyCostCentsLimit', next)
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-app-text-muted">
      {label}
      <Input
        theme="app"
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function toEditableValues(
  value: AiLimitSettingValue | undefined,
): Record<keyof AiLimitSettingValue, string> {
  return {
    dailyRequestLimit: String(value?.dailyRequestLimit ?? 0),
    dailyTokenLimit: String(value?.dailyTokenLimit ?? 0),
    monthlyCostCentsLimit: String(value?.monthlyCostCentsLimit ?? 0),
  };
}

function parseEditableValues(
  value: Record<keyof AiLimitSettingValue, string>,
): { ok: true; value: AiLimitSettingValue } | { ok: false; error: string } {
  const dailyRequestLimit = parseField(
    value.dailyRequestLimit,
    'Daily request limit',
  );
  if (typeof dailyRequestLimit === 'string') {
    return { ok: false, error: dailyRequestLimit };
  }

  const dailyTokenLimit = parseField(value.dailyTokenLimit, 'Daily token limit');
  if (typeof dailyTokenLimit === 'string') {
    return { ok: false, error: dailyTokenLimit };
  }

  const monthlyCostCentsLimit = parseField(
    value.monthlyCostCentsLimit,
    'Monthly cost cap',
  );
  if (typeof monthlyCostCentsLimit === 'string') {
    return { ok: false, error: monthlyCostCentsLimit };
  }

  return {
    ok: true,
    value: {
      dailyRequestLimit,
      dailyTokenLimit,
      monthlyCostCentsLimit,
    },
  };
}

function parseField(value: string, label: string) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return `${label} must be a non-negative whole number.`;
  }

  return numeric;
}
