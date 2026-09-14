import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const;

export function AiUsageFilters({
  basePath,
  activeRange,
  provider,
  model,
  availableProviders,
  availableModels,
}: {
  basePath: string;
  activeRange: string;
  provider?: string;
  model?: string;
  availableProviders: string[];
  availableModels: string[];
}) {
  return (
    <div className="mb-6 rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <div className="flex flex-wrap gap-1 rounded-full border border-app-border-subtle p-1">
        {RANGE_OPTIONS.map((option) => (
          <Link
            key={option.value}
            href={buildHref(basePath, {
              range: option.value,
              provider,
              model,
            })}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activeRange === option.value
                ? 'bg-app-surface-active text-app-text'
                : 'text-app-text-secondary hover:text-app-text',
            )}>
            {option.label}
          </Link>
        ))}
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="range" value={activeRange} />

        <label className="flex min-w-48 flex-col gap-1 text-xs text-app-text-muted">
          Provider
          <Select theme="app" name="provider" defaultValue={provider ?? ''}>
            <option value="">All providers</option>
            {availableProviders.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex min-w-72 flex-col gap-1 text-xs text-app-text-muted">
          Model
          <Select theme="app" name="model" defaultValue={model ?? ''}>
            <option value="">All models</option>
            {availableModels.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </label>

        <Button type="submit" size="sm" theme="app">
          Apply filters
        </Button>

        <Link
          href={buildHref(basePath, { range: activeRange })}
          className="pb-2 text-sm text-app-text-secondary hover:text-app-text">
          Reset
        </Link>
      </form>
    </div>
  );
}

function buildHref(
  pathname: string,
  query: { range?: string; provider?: string; model?: string },
) {
  const params = new URLSearchParams();

  if (query.range) params.set('range', query.range);
  if (query.provider) params.set('provider', query.provider);
  if (query.model) params.set('model', query.model);

  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}
