import Link from 'next/link';

import { cn } from '@/lib/utils';

type AiUsageNavKey = 'overview' | 'users' | 'projects' | 'limits';

const NAV_ITEMS: Array<{
  key: AiUsageNavKey;
  label: string;
  href: string;
}> = [
  { key: 'overview', label: 'Overview', href: '/admin/ai-usage' },
  { key: 'users', label: 'By user', href: '/admin/ai-usage/users' },
  { key: 'projects', label: 'By project', href: '/admin/ai-usage/projects' },
  { key: 'limits', label: 'Limits', href: '/admin/ai-usage/limits' },
];

export function AiUsageNav({
  active,
  query,
}: {
  active: AiUsageNavKey;
  query?: { range?: string; provider?: string; model?: string };
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-full border border-app-border-subtle bg-app-surface p-1">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={buildHref(item.href, query)}
          className={cn(
            'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
            item.key === active
              ? 'bg-app-surface-active text-app-text'
              : 'text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
          )}>
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function buildHref(
  pathname: string,
  query?: { range?: string; provider?: string; model?: string },
) {
  const params = new URLSearchParams();

  if (query?.range) params.set('range', query.range);
  if (query?.provider) params.set('provider', query.provider);
  if (query?.model) params.set('model', query.model);

  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}
