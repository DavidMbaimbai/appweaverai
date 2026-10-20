/**
 * The single source of truth for team roles and what each role may do.
 * Server-side checks go through `lib/team/access.ts`, which resolves a user's role and consults this matrix.
 */

export const TEAM_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'DESIGNER', 'MARKETER', 'BUSINESS_PARTNER', 'VIEWER'] as const;
export type TeamRoleName = (typeof TEAM_ROLES)[number];

export const CAPABILITIES = [
  'view_project',
  'edit_code',
  'run_agent',
  'publish',
  'manage_domains',
  'manage_env_vars',
  'view_secrets',
  'manage_integrations',
  'run_marketing',
  'approve_spend',
  'view_billing',
  'manage_members',
  'manage_board',
  'comment',
  'request_approval',
  'transfer_ownership',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ALL: readonly Capability[] = CAPABILITIES;

export const ROLE_CAPABILITIES: Readonly<Record<TeamRoleName, readonly Capability[]>> = {
  OWNER: ALL,
  ADMIN: ALL.filter((c) => c !== 'transfer_ownership'),
  DEVELOPER: [
    'view_project',
    'edit_code',
    'run_agent',
    'publish',
    'manage_domains',
    'manage_env_vars',
    'view_secrets',
    'manage_integrations',
    'run_marketing',
    'manage_board',
    'comment',
    'request_approval',
  ],
  DESIGNER: ['view_project', 'edit_code', 'run_agent', 'manage_board', 'comment', 'request_approval'],
  MARKETER: ['view_project', 'run_marketing', 'manage_board', 'comment', 'request_approval'],
  BUSINESS_PARTNER: ['view_project', 'comment'],
  VIEWER: ['view_project'],
};

/** Higher outranks lower. Roles of equal rank (the three specialists) are peers. */
export const ROLE_RANK: Readonly<Record<TeamRoleName, number>> = {
  OWNER: 100,
  ADMIN: 80,
  DEVELOPER: 50,
  DESIGNER: 50,
  MARKETER: 50,
  BUSINESS_PARTNER: 20,
  VIEWER: 10,
};

export const ROLE_LABELS: Readonly<Record<TeamRoleName, string>> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  DEVELOPER: 'Developer',
  DESIGNER: 'Designer',
  MARKETER: 'Marketer',
  BUSINESS_PARTNER: 'Business partner',
  VIEWER: 'Viewer',
};

export function isTeamRole(value: unknown): value is TeamRoleName {
  return typeof value === 'string' && (TEAM_ROLES as readonly string[]).includes(value);
}

export function can(role: TeamRoleName | null | undefined, capability: Capability): boolean {
  return !!role && ROLE_CAPABILITIES[role].includes(capability);
}

/**
 * Ownership only moves through a transfer, so OWNER can never be handed out by invite or role change.
 * Everyone else may grant up to their own rank, and only with `manage_members`.
 */
export function canGrantRole(actor: TeamRoleName | null | undefined, target: TeamRoleName): boolean {
  if (!actor || !can(actor, 'manage_members') || target === 'OWNER') return false;
  return ROLE_RANK[target] <= ROLE_RANK[actor];
}

/** Whether `actor` may change or remove a member currently holding `current`. */
export function canManageMember(actor: TeamRoleName | null | undefined, current: TeamRoleName): boolean {
  if (!actor || !can(actor, 'manage_members')) return false;
  if (current === 'OWNER') return actor === 'OWNER';
  return ROLE_RANK[current] <= ROLE_RANK[actor];
}

export type LegacyWorkspaceRole = 'ADMIN' | 'MEMBER' | 'GUEST' | 'VIEWER';
export type LegacyProjectRole = 'OWNER' | 'PUBLISHER' | 'EDITOR' | 'VIEWER';

/** Members created before team roles existed keep the access they had: MEMBER and EDITOR/PUBLISHER stay builders. */
export const LEGACY_WORKSPACE_ROLE: Readonly<Record<LegacyWorkspaceRole, TeamRoleName>> = {
  ADMIN: 'ADMIN',
  MEMBER: 'DEVELOPER',
  GUEST: 'VIEWER',
  VIEWER: 'VIEWER',
};

export const LEGACY_PROJECT_ROLE: Readonly<Record<LegacyProjectRole, TeamRoleName>> = {
  OWNER: 'OWNER',
  PUBLISHER: 'DEVELOPER',
  EDITOR: 'DEVELOPER',
  VIEWER: 'VIEWER',
};

/** The legacy membership row created when a team role is accepted, so existing access checks keep working. */
export function legacyWorkspaceRoleFor(role: TeamRoleName): LegacyWorkspaceRole {
  if (role === 'OWNER' || role === 'ADMIN') return 'ADMIN';
  if (role === 'VIEWER' || role === 'BUSINESS_PARTNER') return 'VIEWER';
  return 'MEMBER';
}

export function legacyProjectRoleFor(role: TeamRoleName): LegacyProjectRole {
  if (role === 'OWNER' || role === 'ADMIN') return 'OWNER';
  if (role === 'VIEWER' || role === 'BUSINESS_PARTNER') return 'VIEWER';
  return role === 'DEVELOPER' ? 'PUBLISHER' : 'EDITOR';
}

export type RoleSources = {
  isWorkspaceOwner: boolean;
  workspaceMemberRole?: LegacyWorkspaceRole | null;
  projectMemberRole?: LegacyProjectRole | null;
  /** Explicit team role for this project (overrides everything except ownership). */
  projectAssignment?: TeamRoleName | null;
  /** Explicit team role for the whole workspace. */
  workspaceAssignment?: TeamRoleName | null;
};

/**
 * Role resolution: the workspace owner is always OWNER; otherwise a project-level team role wins over a
 * workspace-level one, which wins over the legacy membership rows (the highest of those applies).
 * Assignments only count while the user still has a membership row; no membership means no role.
 */
export function deriveEffectiveRole(s: RoleSources): TeamRoleName | null {
  if (s.isWorkspaceOwner) return 'OWNER';
  if (!s.workspaceMemberRole && !s.projectMemberRole) return null;
  if (s.projectAssignment) return s.projectAssignment;
  if (s.workspaceAssignment) return s.workspaceAssignment;
  const legacy: TeamRoleName[] = [];
  if (s.workspaceMemberRole) legacy.push(LEGACY_WORKSPACE_ROLE[s.workspaceMemberRole]);
  if (s.projectMemberRole) legacy.push(LEGACY_PROJECT_ROLE[s.projectMemberRole]);
  return legacy.reduce((best, r) => (ROLE_RANK[r] > ROLE_RANK[best] ? r : best));
}
