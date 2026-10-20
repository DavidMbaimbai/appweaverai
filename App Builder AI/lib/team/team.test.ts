import { beforeAll, describe, expect, it, vi } from 'vitest';

import { planMove, resolveMentions, extractMentionHandles, sanitizeTaskInput, POSITION_STEP } from './board-logic';
import { signInvitationToken, verifyInvitationToken, normalizeInviteEmail } from './invitation-token';
import { CAPABILITIES, ROLE_CAPABILITIES, TEAM_ROLES, can, canGrantRole, canManageMember, deriveEffectiveRole } from './permissions';
import { seatLimitForTier, seatsAvailable } from './seats';
import { exceedsLimit, effectiveCredits } from './spend';
import { channelsFor } from './notifications';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

describe('permission matrix', () => {
  it('marketers cannot edit code, see secrets or publish, but can run marketing', () => {
    expect(can('MARKETER', 'edit_code')).toBe(false);
    expect(can('MARKETER', 'view_secrets')).toBe(false);
    expect(can('MARKETER', 'manage_env_vars')).toBe(false);
    expect(can('MARKETER', 'publish')).toBe(false);
    expect(can('MARKETER', 'run_marketing')).toBe(true);
  });

  it('designers can edit code and run the agent but cannot publish or see secrets', () => {
    expect(can('DESIGNER', 'edit_code')).toBe(true);
    expect(can('DESIGNER', 'run_agent')).toBe(true);
    expect(can('DESIGNER', 'publish')).toBe(false);
    expect(can('DESIGNER', 'view_secrets')).toBe(false);
    expect(can('DESIGNER', 'manage_domains')).toBe(false);
  });

  it('business partners and viewers are read-only', () => {
    const writes = CAPABILITIES.filter((c) => c !== 'view_project' && c !== 'comment');
    for (const c of writes) {
      expect(can('BUSINESS_PARTNER', c)).toBe(false);
      expect(can('VIEWER', c)).toBe(false);
    }
    expect(can('BUSINESS_PARTNER', 'comment')).toBe(true);
    expect(can('VIEWER', 'comment')).toBe(false);
  });

  it('only owners and admins approve spend, see billing or manage members; only the owner transfers', () => {
    for (const role of TEAM_ROLES) {
      const privileged = role === 'OWNER' || role === 'ADMIN';
      expect(can(role, 'approve_spend')).toBe(privileged);
      expect(can(role, 'view_billing')).toBe(privileged);
      expect(can(role, 'manage_members')).toBe(privileged);
      expect(can(role, 'transfer_ownership')).toBe(role === 'OWNER');
    }
  });

  it('every role can view the project and unknown or missing roles can do nothing', () => {
    for (const role of TEAM_ROLES) expect(ROLE_CAPABILITIES[role]).toContain('view_project');
    expect(can(null, 'view_project')).toBe(false);
  });

  it('blocks privilege escalation', () => {
    expect(canGrantRole('ADMIN', 'OWNER')).toBe(false);
    expect(canGrantRole('OWNER', 'OWNER')).toBe(false);
    expect(canGrantRole('ADMIN', 'ADMIN')).toBe(true);
    expect(canGrantRole('DEVELOPER', 'VIEWER')).toBe(false);
    expect(canGrantRole('ADMIN', 'MARKETER')).toBe(true);
    expect(canManageMember('ADMIN', 'OWNER')).toBe(false);
    expect(canManageMember('OWNER', 'ADMIN')).toBe(true);
  });

  it('derives the effective role with owner first, explicit assignments over legacy rows, and no access without membership', () => {
    expect(deriveEffectiveRole({ isWorkspaceOwner: true, workspaceAssignment: 'VIEWER' })).toBe('OWNER');
    expect(deriveEffectiveRole({ isWorkspaceOwner: false })).toBeNull();
    expect(deriveEffectiveRole({ isWorkspaceOwner: false, workspaceMemberRole: 'MEMBER' })).toBe('DEVELOPER');
    expect(deriveEffectiveRole({ isWorkspaceOwner: false, workspaceMemberRole: 'MEMBER', workspaceAssignment: 'MARKETER' })).toBe('MARKETER');
    expect(
      deriveEffectiveRole({ isWorkspaceOwner: false, workspaceMemberRole: 'MEMBER', workspaceAssignment: 'MARKETER', projectMemberRole: 'EDITOR', projectAssignment: 'DESIGNER' }),
    ).toBe('DESIGNER');
  });
});

describe('invitation tokens', () => {
  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = 'unit-test-secret-unit-test-secret';
  });
  const now = new Date('2026-01-01T00:00:00Z');

  it('round-trips and expires', () => {
    const token = signInvitationToken({ id: 'inv1', version: 2, expiresAt: now.getTime() + 1000 });
    expect(verifyInvitationToken(token, now)).toEqual({ id: 'inv1', version: 2, expiresAt: now.getTime() + 1000 });
    expect(verifyInvitationToken(token, new Date(now.getTime() + 2000))).toBeNull();
  });

  it('rejects tampered or malformed tokens', () => {
    const token = signInvitationToken({ id: 'inv1', version: 1, expiresAt: now.getTime() + 1000 });
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ i: 'inv2', v: 1, e: now.getTime() + 1000 })).toString('base64url');
    expect(verifyInvitationToken(`${forged}.${sig}`, now)).toBeNull();
    expect(verifyInvitationToken(`${body}.x${sig}`, now)).toBeNull();
    expect(verifyInvitationToken('garbage', now)).toBeNull();
  });

  it('normalises emails', () => {
    expect(normalizeInviteEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    expect(normalizeInviteEmail('nope')).toBeNull();
  });
});

describe('seats', () => {
  it('uses env overrides and counts pending invitations', () => {
    expect(seatLimitForTier('free', { TEAM_SEATS_FREE: '3' } as unknown as NodeJS.ProcessEnv)).toBe(3);
    expect(seatsAvailable({ used: 1, pending: 1, limit: 2 })).toBe(false);
    expect(seatsAvailable({ used: 1, pending: 0, limit: 2 })).toBe(true);
  });
});

describe('board ordering', () => {
  const col = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 2048 },
    { id: 'c', position: 3072 },
  ];

  it('moves between neighbours and to the end', () => {
    expect(planMove(col, 'c', 'b').position).toBe(1536 + 0 * POSITION_STEP);
    expect(planMove(col, 'a', null).position).toBe(3072 + POSITION_STEP);
    expect(planMove(col, 'x', 'a').position).toBe(1024 - POSITION_STEP);
  });

  it('falls back to the bottom when the anchor vanished', () => {
    expect(planMove(col, 'a', 'gone').position).toBe(3072 + POSITION_STEP);
  });

  it('rebalances when positions are too tight', () => {
    const tight = [
      { id: 'a', position: 1 },
      { id: 'b', position: 1 + 1e-9 },
    ];
    const plan = planMove(tight, 'z', 'b');
    expect(plan.rebalance).toEqual(['a', 'z', 'b']);
  });
});

describe('task input', () => {
  it('requires a title and normalises labels', () => {
    expect(sanitizeTaskInput({ title: '   ' }).ok).toBe(false);
    const r = sanitizeTaskInput({ title: ' Fix ', labels: ['Bug', 'Bug', ' '], priority: 'HIGH' });
    expect(r.ok && r.value.title).toBe('Fix');
    expect(r.ok && r.value.labels).toEqual(['Bug']);
  });
  it('falls back to MEDIUM for an unknown priority and rejects too many labels', () => {
    const r = sanitizeTaskInput({ title: 'x', priority: 'NOPE' });
    expect(r.ok && r.value.priority).toBe('MEDIUM');
    expect(sanitizeTaskInput({ title: 'x', labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).ok).toBe(false);
  });
});

describe('mentions', () => {
  it('extracts unique handles and ignores emails', () => {
    expect(extractMentionHandles('hi @Ann and @ann, mail bob@example.com @cy_1')).toEqual(['ann', 'cy_1']);
  });
  it('resolves only candidates in scope', () => {
    const people = [
      { id: '1', username: 'ann', email: 'a@x.com' },
      { id: '2', username: null, email: 'bob@x.com' },
    ];
    expect(resolveMentions('@bob @ann @mallory', people).sort()).toEqual(['1', '2']);
  });
});

describe('spend and notifications helpers', () => {
  it('counts open reservations at their maximum and released ones at zero', () => {
    expect(effectiveCredits({ status: 'RESERVED', maxCredits: 10, settledCredits: null })).toBe(10);
    expect(effectiveCredits({ status: 'SETTLED', maxCredits: 10, settledCredits: 4 })).toBe(4);
    expect(effectiveCredits({ status: 'RELEASED', maxCredits: 10, settledCredits: null })).toBe(0);
    expect(effectiveCredits(undefined)).toBe(0);
  });
  it('treats a null limit as unlimited', () => {
    expect(exceedsLimit(null, 1e9)).toBe(false);
    expect(exceedsLimit(100, 100)).toBe(false);
    expect(exceedsLimit(100, 101)).toBe(true);
  });
  it('defaults notification channels on', () => {
    expect(channelsFor(null)).toEqual({ inApp: true, email: true });
    expect(channelsFor({ inApp: false, email: true })).toEqual({ inApp: false, email: true });
  });
});
