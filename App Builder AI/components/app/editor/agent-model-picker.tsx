'use client';

import { useEffect, useRef, useState } from 'react';

import {
  AGENT_MODEL_OPTIONS,
  getAgentModelOption,
  type AgentModelId,
} from '@/lib/agent/model-catalog';
import { cn } from '@/lib/utils';

type AgentModelPickerProps = {
  value: AgentModelId;
  onChange: (modelId: AgentModelId) => void;
  disabled?: boolean;
};

export function AgentModelPicker({
  value,
  onChange,
  disabled,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = getAgentModelOption(value);

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
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border border-app-border-subtle px-2.5 py-1.5 text-xs font-medium text-app-text-secondary transition-colors hover:bg-app-surface-hover hover:text-app-text disabled:cursor-not-allowed disabled:opacity-50',
          open && 'bg-app-surface-hover text-app-text',
        )}>
        <ModelIcon />
        {selected.label}
        <ChevronDownIcon />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Agent model"
          className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl border border-app-border bg-app-surface py-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
          {AGENT_MODEL_OPTIONS.map((option) => {
            const isSelected = option.id === value;

            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors',
                  isSelected
                    ? 'bg-app-surface-active text-app-text'
                    : 'text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
                )}>
                <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
                  {option.label}
                  {isSelected ? <CheckIcon /> : null}
                </span>
                <span className="text-xs text-app-text-muted">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ModelIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.8l-4.9 2.4.9-5.5-4-3.9 5.5-.8L12 3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
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
