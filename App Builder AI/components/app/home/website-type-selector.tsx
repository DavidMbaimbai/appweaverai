'use client';

import { WEBSITE_TYPES } from '@/lib/website-types';
import { cn } from '@/lib/utils';

type WebsiteTypeSelectorProps = {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
};

export function WebsiteTypeSelector({
  value,
  onChange,
  disabled,
}: WebsiteTypeSelectorProps) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-center text-xs text-app-text-muted">
        What type of website is it? (optional)
      </p>
      <div
        role="radiogroup"
        aria-label="Website type"
        className="flex flex-wrap justify-center gap-2">
        {WEBSITE_TYPES.map((type) => {
          const selected = value === type.id;
          return (
            <button
              key={type.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(selected ? null : type.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50',
                selected
                  ? 'border-appweaver-orange/40 bg-app-surface-active text-appweaver-orange'
                  : 'border-app-border-subtle text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
              )}>
              {type.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
