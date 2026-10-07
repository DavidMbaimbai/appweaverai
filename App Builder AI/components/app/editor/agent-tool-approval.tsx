'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AgentToolApprovalProps = {
  toolName: string;
  input: Record<string, unknown>;
  onApprove: () => void;
  onDeny: () => void;
  disabled?: boolean;
  className?: string;
};

const TOOL_LABELS: Record<string, string> = {
  delete_file: 'delete a file',
};

function describeInput(toolName: string, input: Record<string, unknown>) {
  if (toolName === 'delete_file' && typeof input.path === 'string') {
    return input.path;
  }
  return JSON.stringify(input);
}

export function AgentToolApproval({
  toolName,
  input,
  onApprove,
  onDeny,
  disabled = false,
  className,
}: AgentToolApprovalProps) {
  const action = TOOL_LABELS[toolName] ?? `run ${toolName}`;

  return (
    <div
      className={cn(
        'flex w-full max-w-full flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3',
        className,
      )}>
      <p className="text-sm text-app-text">
        The agent wants to <span className="font-medium">{action}</span>:{' '}
        <code className="rounded bg-app-surface-active px-1 py-0.5 text-xs">
          {describeInput(toolName, input)}
        </code>
      </p>
      <p className="text-xs text-app-text-muted">
        This action can&apos;t be easily undone. Approve only if you expect it.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          theme="app"
          className="flex-1 bg-red-600 text-white hover:bg-red-500"
          disabled={disabled}
          onClick={onApprove}>
          Approve
        </Button>
        <Button
          type="button"
          variant="secondary"
          theme="app"
          className="flex-1"
          disabled={disabled}
          onClick={onDeny}>
          Deny
        </Button>
      </div>
    </div>
  );
}
