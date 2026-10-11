'use client';

import { useEffect, useRef, useState } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import {
  getPreviewDevicePreset,
  PREVIEW_DEVICE_PRESETS,
  type PreviewDeviceId,
} from '@/lib/preview/preview-device-sizes';
import { cn } from '@/lib/utils';

type PreviewDeviceMenuProps = {
  value: PreviewDeviceId;
  onChange: (deviceId: PreviewDeviceId) => void;
  landscape: boolean;
  onToggleLandscape: () => void;
};

const QUICK_VIEWS: {
  label: string;
  deviceId: PreviewDeviceId;
  matches: PreviewDeviceId[];
}[] = [
  { label: 'Desktop', deviceId: 'full', matches: ['full'] },
  { label: 'Tablet', deviceId: 'ipad-mini', matches: ['ipad-mini'] },
  {
    label: 'Mobile',
    deviceId: 'iphone-17-pro',
    matches: [
      'iphone-17-pro',
      'iphone-17-pro-max',
      'galaxy-s25',
      'galaxy-s25-plus',
    ],
  },
];

export function PreviewDeviceMenu(props: PreviewDeviceMenuProps) {
  const { value, onChange, landscape, onToggleLandscape } = props;
  return (
    <div className="flex items-center gap-1.5">
      <div
        role="group"
        aria-label="Preview as"
        className="inline-flex h-8 items-center rounded-lg border border-app-border p-0.5">
        {QUICK_VIEWS.map((view) => {
          const active = view.matches.includes(value);
          return (
            <button
              key={view.label}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(view.deviceId)}
              className={cn(
                'h-full rounded-md px-2 text-xs font-medium transition-colors',
                active
                  ? 'bg-app-surface-active text-app-text'
                  : 'text-app-text-muted hover:text-app-text-secondary',
              )}>
              {view.label}
            </button>
          );
        })}
      </div>
      {value !== 'full' ? (
        <button
          type="button"
          aria-pressed={landscape}
          aria-label="Rotate to landscape"
          title={landscape ? 'Switch to portrait' : 'Switch to landscape'}
          onClick={onToggleLandscape}
          className={cn(
            'h-8 rounded-lg border border-app-border px-2 text-xs font-medium transition-colors',
            landscape
              ? 'bg-app-surface-active text-app-text'
              : 'text-app-text-muted hover:text-app-text-secondary',
          )}>
          {landscape ? 'Landscape' : 'Portrait'}
        </button>
      ) : null}
      <PreviewDeviceSizeMenu {...props} />
    </div>
  );
}

function PreviewDeviceSizeMenu({ value, onChange }: PreviewDeviceMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = getPreviewDevicePreset(value);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        label={`Preview size: ${selected.label}`}
        size="sm"
        theme="app"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className={cn(open && 'bg-app-surface-hover')}>
        <DeviceIcon />
      </IconButton>

      {open ? (
        <div
          role="menu"
          aria-label="Preview device sizes"
          className="absolute right-0 top-full z-50 mt-2 max-h-[min(24rem,calc(100vh-12rem))] w-56 overflow-y-auto rounded-xl border border-app-border bg-app-surface py-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
          {PREVIEW_DEVICE_PRESETS.map((preset) => {
            const isSelected = preset.id === value;

            return (
              <button
                key={preset.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onChange(preset.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-app-surface-active text-app-text'
                    : 'text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
                )}>
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {isSelected ? <CheckIcon /> : null}
                </span>
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DeviceIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <rect
        x="7"
        y="3"
        width="10"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="3"
        y="5"
        width="14"
        height="14"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.45"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M5 12l5 5L20 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
