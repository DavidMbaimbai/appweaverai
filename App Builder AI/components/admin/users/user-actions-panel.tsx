'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ReasonActionButton } from './reason-action-button';
import {
  adjustCreditsAction,
  banUserAction,
  disableUserAction,
  reactivateUserAction,
  setUserRoleAction,
  suspendUserAction,
} from '@/lib/admin/actions/users';
import type { AccountStatus, AdminRole } from '@/lib/generated/prisma/client';

const ADMIN_ROLES: AdminRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCE_ADMIN',
  'SUPPORT_ADMIN',
  'ANALYTICS_VIEWER',
  'SECURITY_ADMIN',
];

export function UserActionsPanel({
  userId,
  accountStatus,
  adminRole,
  canWrite,
  canBan,
  canSetRole,
}: {
  userId: string;
  accountStatus: AccountStatus;
  adminRole: AdminRole | null;
  canWrite: boolean;
  canBan: boolean;
  canSetRole: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-app-text">
          Account actions
        </h2>
        <div className="flex flex-wrap gap-2">
          {accountStatus !== 'ACTIVE' && (canWrite || canBan) ? (
            <ReactivateButton userId={userId} />
          ) : null}
          {canWrite && accountStatus === 'ACTIVE' ? (
            <ReasonActionButton
              label="Suspend"
              title="Suspend account"
              description="Suspended users cannot perform protected platform actions until reactivated."
              confirmLabel="Suspend"
              onSubmit={(reason) => suspendUserAction(userId, reason)}
            />
          ) : null}
          {canWrite && accountStatus !== 'DISABLED' ? (
            <ReasonActionButton
              label="Disable"
              title="Disable account"
              description="Disabling requires elevated permission and is separate from a temporary suspension."
              confirmLabel="Disable"
              onSubmit={(reason) => disableUserAction(userId, reason)}
            />
          ) : null}
          {canBan && accountStatus !== 'BANNED' ? (
            <ReasonActionButton
              label="Ban"
              title="Ban account"
              description="Banned accounts cannot authenticate. All active sessions are revoked immediately."
              confirmLabel="Ban account"
              variant="primary"
              withExpiry
              onSubmit={(reason, expiresAt) =>
                banUserAction(userId, reason, expiresAt)
              }
            />
          ) : null}
        </div>
      </div>

      {canWrite ? (
        <CreditsForm userId={userId} />
      ) : null}

      {canSetRole ? (
        <RoleForm userId={userId} currentRole={adminRole} />
      ) : null}
    </div>
  );
}

function ReactivateButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <Button
      type="button"
      size="sm"
      variant="primary"
      theme="app"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await reactivateUserAction(userId);
          if ('error' in result) toast.error(result.error);
          else toast.success('Account reactivated.');
        })
      }>
      {isPending ? 'Working...' : 'Reactivate'}
    </Button>
  );
}

function CreditsForm({ userId }: { userId: string }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-app-text">
        Adjust credits
      </h2>
      <div className="space-y-2">
        <Input
          theme="app"
          type="number"
          placeholder="Amount (use negative to deduct)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          theme="app"
          placeholder="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          theme="app"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await adjustCreditsAction(
                userId,
                Number(amount),
                reason,
              );
              if ('error' in result) {
                toast.error(result.error);
                return;
              }
              toast.success('Credits adjusted.');
              setAmount('');
              setReason('');
            })
          }>
          {isPending ? 'Working...' : 'Apply adjustment'}
        </Button>
      </div>
    </div>
  );
}

function RoleForm({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: AdminRole | null;
}) {
  const [role, setRole] = useState(currentRole ?? '');
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <div className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
      <h2 className="mb-3 text-sm font-medium text-app-text">Admin role</h2>
      <div className="space-y-2">
        <Select
          theme="app"
          value={role}
          onChange={(e) => setRole(e.target.value)}>
          <option value="">No admin access</option>
          {ADMIN_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          size="sm"
          theme="app"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await setUserRoleAction(
                userId,
                (role || null) as AdminRole | null,
              );
              if ('error' in result) toast.error(result.error);
              else toast.success('Role updated.');
            })
          }>
          {isPending ? 'Working...' : 'Save role'}
        </Button>
      </div>
    </div>
  );
}
