import type { DevTeamRoleName } from './types';

/**
 * Role permission scopes, enforced in code (never by prompt alone). Models have no tools: the only way a
 * role can touch the project is by returning change proposals, and every proposal passes `authoriseProposal`.
 * No role can apply, publish, send messages or spend marketing credits - applying is a human decision.
 */

export type DevTeamAction =
  | 'read_project'
  | 'post_message'
  | 'propose_change'
  | 'apply_change'
  | 'publish'
  | 'send_external_message'
  | 'spend_marketing_credits'
  | 'spend_dev_credits';

type RoleSpec = {
  /** Path patterns the role may propose changes to. Empty = read-only reviewer. */
  writeScopes: RegExp[];
};

const FRONTEND: RegExp[] = [
  /\.(html?|css|scss|sass|less|svg|vue|svelte|jsx|tsx)$/i,
  /(^|\/)(components|pages|styles|public|assets|ui|views|hooks)\/.+\.(m?[jt]s|json|md)$/i,
];

const BACKEND: RegExp[] = [
  /(^|\/)(api|server|services|lib|functions|routes|middleware|backend|controllers)\/.+\.(m?[jt]s|cjs|py|rb|php|go)$/i,
  /(^|\/)(route|server|middleware|proxy)\.(m?[jt]s)$/i,
  /(^|\/)(index|app|server)\.(js|mjs|cjs)$/i,
];

const DATABASE: RegExp[] = [
  /(^|\/)(prisma|db|database|migrations|sql|seeds?)\/.+/i,
  /\.(sql|prisma)$/i,
  /(^|\/)(schema|seed)\.(m?[jt]s)$/i,
];

const DEVOPS: RegExp[] = [
  /(^|\/)package\.json$/i,
  /(^|\/)tsconfig[\w.-]*\.json$/i,
  /(^|\/)(next|vite|vitest|jest|eslint|tailwind|postcss|webpack|rollup)\.config\.[cm]?[jt]s$/i,
  /(^|\/)\.eslintrc[\w.]*$/i,
  /(^|\/)(Dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|vercel\.json|netlify\.toml|Makefile|\.dockerignore|\.gitignore|\.env\.example|\.env\.sample)$/i,
  /(^|\/)\.github\/workflows\/.+\.ya?ml$/i,
  /(^|\/)(\.husky|scripts)\/.+/i,
];

const ROLE_SPECS: Record<DevTeamRoleName, RoleSpec> = {
  ARCHITECT: { writeScopes: [] },
  FRONTEND: { writeScopes: FRONTEND },
  BACKEND: { writeScopes: BACKEND },
  DATABASE: { writeScopes: DATABASE },
  TESTING: { writeScopes: [] },
  SECURITY: { writeScopes: [] },
  DEVOPS: { writeScopes: DEVOPS },
};

/** Files no role may read or change, whatever the scope: secrets, VCS data, dependencies, build output, lockfiles. */
const FORBIDDEN = [
  /(^|\/)\.env(\.(?!example$|sample$)[^/]*)?$/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /(^|\/)(id_rsa|id_ed25519)(\.pub)?$/i,
];

export const MAX_PATH_CHARS = 200;

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

/** Normalises a project-relative path and rejects anything that could escape the artifact or is never allowed. */
export function normaliseProposalPath(input: unknown): PathCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'Path must be text.' };
  if (input.includes('\u0000')) return { ok: false, reason: 'Path contains a null byte.' };
  const slashed = input.trim().replace(/\\/g, '/');
  if (!slashed || slashed.length > MAX_PATH_CHARS) return { ok: false, reason: 'Path is empty or too long.' };
  if (slashed.startsWith('/') || /^[a-z]:/i.test(slashed)) return { ok: false, reason: 'Path must be relative to the project.' };
  const segments = slashed.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return { ok: false, reason: 'Path must not leave the project.' };
  if (segments.length === 0) return { ok: false, reason: 'Path is empty.' };
  const path = segments.join('/');
  if (FORBIDDEN.some((pattern) => pattern.test(path))) return { ok: false, reason: 'This file is off limits to the AI team.' };
  return { ok: true, path };
}

export function isReadOnlyRole(role: DevTeamRoleName): boolean {
  return ROLE_SPECS[role].writeScopes.length === 0;
}

export type Authorisation = { allowed: true } | { allowed: false; reason: string };

/** Action-level gate. Only reading, posting to the shared log, proposing changes and (for the engine) dev credits are ever allowed to a role. */
export function authoriseAction(role: DevTeamRoleName, action: DevTeamAction): Authorisation {
  switch (action) {
    case 'read_project':
    case 'post_message':
      return { allowed: true };
    case 'propose_change':
      return isReadOnlyRole(role)
        ? { allowed: false, reason: `${role} is a read-only role and cannot propose file changes.` }
        : { allowed: true };
    case 'apply_change':
      return { allowed: false, reason: 'Roles never apply changes; a person must approve and apply them.' };
    case 'publish':
      return { allowed: false, reason: 'Roles can never publish.' };
    case 'send_external_message':
      return { allowed: false, reason: 'Roles can never send emails, SMS, social posts or other messages.' };
    case 'spend_marketing_credits':
      return { allowed: false, reason: 'Roles can never spend marketing credits.' };
    case 'spend_dev_credits':
      return { allowed: false, reason: 'Roles cannot spend credits; only the run budget does.' };
  }
}

/** Whether `role` may propose a change to `path` (path must already be normalised). */
export function authoriseProposal(role: DevTeamRoleName, path: string): Authorisation {
  const action = authoriseAction(role, 'propose_change');
  if (!action.allowed) return action;
  const check = normaliseProposalPath(path);
  if (!check.ok) return { allowed: false, reason: check.reason };
  if (!ROLE_SPECS[role].writeScopes.some((pattern) => pattern.test(check.path))) {
    return { allowed: false, reason: `${role} may not change ${check.path}; it is outside this role's scope.` };
  }
  return { allowed: true };
}

/** Whether a role may read a file (everything except secrets and generated files). */
export function mayRead(path: string): boolean {
  const check = normaliseProposalPath(path);
  return check.ok;
}

export function describeScope(role: DevTeamRoleName): string {
  switch (role) {
    case 'FRONTEND':
      return 'UI files: html/css/svg/vue/svelte/jsx/tsx and files under components, pages, styles, public, assets, ui, views, hooks.';
    case 'BACKEND':
      return 'Server code under api, server, services, lib, functions, routes, middleware, controllers, plus route/server/middleware files.';
    case 'DATABASE':
      return 'Schema, migrations and queries: prisma/, db/, database/, migrations/, sql/, *.sql, *.prisma.';
    case 'DEVOPS':
      return 'Build and deployment config: package.json, tsconfig, *.config.*, Dockerfile, CI workflows, .env.example (never real .env files).';
    default:
      return 'None. This role is read-only and reports findings as notes.';
  }
}
