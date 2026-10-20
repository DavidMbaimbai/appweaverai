'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  setSpendLimitAction,
  transferOwnershipAction,
} from '@/lib/team/actions';
import { ROLE_LABELS, TEAM_ROLES, canGrantRole, can, type TeamRoleName } from '@/lib/team/permissions';

type Props = {
  workspace: { id: string; name: string; slug: string };
  role: TeamRoleName;
  isOwner: boolean;
  members: Array<{ userId: string; name: string | null; email: string | null; role: TeamRoleName; isOwner: boolean }>;
  invitations: Array<{ id: string; email: string; role: string; expiresAt: string }>;
  seats: { used: number; pending: number; limit: number } | null;
  usage: Array<{ userId: string; name: string | null; email: string | null; marketingCredits: number; marketingOperations: number; monthlyLimit: number | null; developmentCredits: number }> | null;
};

export function TeamPanel({ workspace, role, isOwner, members, invitations, seats, usage }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRoleName>('DEVELOPER');
  const manage = can(role, 'manage_members');
  const grantable = TEAM_ROLES.filter((r) => canGrantRole(role, r));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setMessage(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setMessage(r.error ?? 'Something went wrong.');
      else done?.();
      router.refresh();
    });
  }

  return (
    <section aria-label={workspace.name} className="space-y-4 rounded-lg border border-app-border p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{workspace.name}</h2>
        <span className="text-sm text-app-text-muted">
          Your role: {ROLE_LABELS[role]}
          {seats ? ` · Seats ${seats.used + seats.pending}/${seats.limit}` : ''}
        </span>
      </header>
      {message ? <p role="alert" className="text-sm text-red-500">{message}</p> : null}

      <ul className="divide-y divide-app-border text-sm">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>{m.name ?? m.email} <span className="text-app-text-muted">{m.email}</span></span>
            {manage && !m.isOwner ? (
              <span className="flex items-center gap-2">
                <select
                  aria-label={`Role for ${m.name ?? m.email}`}
                  disabled={pending}
                  value={m.role}
                  onChange={(e) => run(() => changeMemberRoleAction({ workspaceId: workspace.id, targetUserId: m.userId, role: e.target.value }))}
                  className="rounded border border-app-border bg-app-surface px-1 py-0.5"
                >
                  {TEAM_ROLES.filter((r) => canGrantRole(role, r) || r === m.role).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <button type="button" className="text-red-500" disabled={pending} onClick={() => run(() => removeMemberAction({ workspaceId: workspace.id, targetUserId: m.userId }))}>Remove</button>
              </span>
            ) : (
              <span className="text-app-text-muted">{m.isOwner ? 'Owner (billing)' : ROLE_LABELS[m.role]}</span>
            )}
          </li>
        ))}
      </ul>

      {manage ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Invite</h3>
          <form
            className="flex flex-wrap gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => inviteMemberAction({ workspaceId: workspace.id, email, role: inviteRole }), () => setEmail(''));
            }}
          >
            <input type="email" required aria-label="Email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border border-app-border bg-app-surface px-2 py-1" />
            <select aria-label="Invite role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as TeamRoleName)} className="rounded border border-app-border bg-app-surface px-2 py-1">
              {grantable.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button type="submit" disabled={pending} className="rounded bg-app-accent px-3 py-1 text-white">Send invite</button>
          </form>
          <ul className="text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-1">
                <span>{i.email} · {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => run(() => resendInvitationAction(i.id))}>Resend</button>
                  <button type="button" className="text-red-500" onClick={() => run(() => revokeInvitationAction(i.id))}>Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {usage ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Usage this month</h3>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-app-text-muted">
                <th>Member</th>
                <th>Marketing credits</th>
                <th>Dev credits</th>
                <th>Monthly limit</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.userId}>
                  <td>{u.name ?? u.email}</td>
                  <td>{u.marketingCredits}</td>
                  <td>{u.developmentCredits}</td>
                  <td>
                    {manage ? (
                      <input
                        type="number"
                        min={0}
                        aria-label={`Limit for ${u.name ?? u.email}`}
                        placeholder="Unlimited"
                        defaultValue={u.monthlyLimit ?? ''}
                        className="w-24 rounded border border-app-border bg-app-surface px-1"
                        onBlur={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          if (v !== u.monthlyLimit) run(() => setSpendLimitAction({ workspaceId: workspace.id, userId: u.userId, monthlyLimit: v }));
                        }}
                      />
                    ) : (
                      (u.monthlyLimit ?? 'Unlimited')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {isOwner && members.length > 1 ? <TransferOwnership workspace={workspace} members={members} run={run} /> : null}
    </section>
  );
}

function TransferOwnership({ workspace, members, run }: { workspace: Props['workspace']; members: Props['members']; run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void }) {
  const [target, setTarget] = useState('');
  const [slug, setSlug] = useState('');
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-app-text-muted">Transfer ownership</summary>
      <p className="my-2 text-app-text-muted">The new owner becomes the billing owner and pays for shared marketing credits. Type the workspace slug ({workspace.slug}) to confirm.</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="New owner" value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-app-border bg-app-surface px-2 py-1">
          <option value="">Choose a member</option>
          {members.filter((m) => !m.isOwner).map((m) => (
            <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>
          ))}
        </select>
        <input aria-label="Confirm workspace slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="rounded border border-app-border bg-app-surface px-2 py-1" />
        <button type="button" disabled={!target || !slug} className="rounded border border-red-500 px-3 py-1 text-red-500" onClick={() => run(() => transferOwnershipAction({ workspaceId: workspace.id, newOwnerId: target, confirmSlug: slug }))}>Transfer</button>
      </div>
    </details>
  );
}
