import { randomBytes, timingSafeEqual } from 'node:crypto';

export const STAGING_COOKIE_PREFIX = 'aw_stg_';
export const STAGING_TOKEN_PARAM = 'token';

export function stagingCookieName(projectId: string) {
  return `${STAGING_COOKIE_PREFIX}${projectId}`;
}

export function generateStagingToken() {
  return randomBytes(24).toString('base64url');
}

/** Constant-time comparison; false when either side is missing. */
export function tokensMatch(expected: string | null, provided: string | null | undefined) {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type StagingAccessInput = {
  /** The staging deployment's share token; null means the link is open. */
  deploymentToken: string | null;
  queryToken?: string | null;
  cookieToken?: string | null;
  isMember: boolean;
};

export type StagingAccess =
  | { allowed: true; via: 'member' | 'open' | 'query' | 'cookie' }
  | { allowed: false };

export function decideStagingAccess(input: StagingAccessInput): StagingAccess {
  if (input.isMember) return { allowed: true, via: 'member' };
  if (!input.deploymentToken) return { allowed: true, via: 'open' };
  if (tokensMatch(input.deploymentToken, input.queryToken)) {
    return { allowed: true, via: 'query' };
  }
  if (tokensMatch(input.deploymentToken, input.cookieToken)) {
    return { allowed: true, via: 'cookie' };
  }
  return { allowed: false };
}

/** Headers every staging response carries so search engines never index it. */
export const STAGING_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
};

type DeploymentRef = { version: number; visibility: string };

export type PromotionPlan =
  | {
      ok: true;
      /** Version number the new production deployment will get. */
      newVersion: number;
      /** Staging version whose stored files are copied byte-for-byte. */
      sourceVersion: number;
      visibility: string;
    }
  | { ok: false; error: string };

/**
 * Decides whether the live staging deployment can be promoted. Promotion
 * copies the stored staging version; it never rebuilds from working files.
 */
export function planPromotion(input: {
  staging: DeploymentRef | null;
  production: (DeploymentRef & { promotedFromVersion: number | null }) | null;
  latestVersion: number;
  stagingSnapshotExists: boolean;
  /** Visibility for the production deployment; staging itself is token-gated. */
  productionVisibility: string;
}): PromotionPlan {
  if (!input.staging) {
    return { ok: false, error: 'Publish to staging before promoting to production.' };
  }
  if (!input.stagingSnapshotExists) {
    return {
      ok: false,
      error: `The files for staging v${input.staging.version} are no longer stored. Publish to staging again.`,
    };
  }
  if (input.production?.promotedFromVersion === input.staging.version) {
    return {
      ok: false,
      error: `Staging v${input.staging.version} is already live in production.`,
    };
  }
  return {
    ok: true,
    newVersion: input.latestVersion + 1,
    sourceVersion: input.staging.version,
    visibility: input.productionVisibility,
  };
}
