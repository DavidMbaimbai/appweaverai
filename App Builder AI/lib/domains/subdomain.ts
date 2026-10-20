/**
 * Pure helpers for managed subdomains (`<label>.<APP_ROOT_DOMAIN>`). No
 * database/Node imports so proxy.ts can use them.
 */

export const DEFAULT_APP_ROOT_DOMAIN = 'appweaverai.com';

export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'mail',
  'email',
  'smtp',
  'imap',
  'pop',
  'ftp',
  'ns',
  'ns1',
  'ns2',
  'mx',
  'cdn',
  'static',
  'assets',
  'media',
  'dashboard',
  'console',
  'billing',
  'support',
  'help',
  'docs',
  'blog',
  'status',
  'staging',
  'stage',
  'dev',
  'test',
  'demo',
  'preview',
  'beta',
  'login',
  'auth',
  'signup',
  'account',
  'accounts',
  'secure',
  'root',
  'webmaster',
  'postmaster',
  'abuse',
  'security',
  'appweaver',
  'appweaverai',
  'p',
]);

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function getAppRootDomain(): string {
  const configured = process.env.APP_ROOT_DOMAIN?.trim().toLowerCase();
  return configured || DEFAULT_APP_ROOT_DOMAIN;
}

export function subdomainHost(label: string, rootDomain = getAppRootDomain()) {
  return `${label}.${rootDomain}`;
}

export type SubdomainValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeSubdomain(input: string) {
  return input.trim().toLowerCase();
}

export function validateSubdomain(input: string): SubdomainValidation {
  const value = normalizeSubdomain(input);

  if (value.length < 3 || value.length > 63) {
    return { ok: false, error: 'Subdomain must be 3–63 characters long.' };
  }
  if (!LABEL_PATTERN.test(value)) {
    return {
      ok: false,
      error:
        'Use only lowercase letters, numbers and hyphens, and don’t start or end with a hyphen.',
    };
  }
  if (value.slice(2, 4) === '--') {
    return { ok: false, error: 'Subdomain cannot contain "--" in this position.' };
  }
  if (RESERVED_SUBDOMAINS.has(value)) {
    return { ok: false, error: `“${value}” is reserved. Choose another name.` };
  }

  return { ok: true, value };
}

/**
 * Returns the claimable label when `host` is exactly `<label>.<rootDomain>`
 * and the label is valid and not reserved, otherwise null.
 */
export function extractSubdomainLabel(
  host: string,
  rootDomain = getAppRootDomain(),
): string | null {
  const normalizedHost = host.trim().toLowerCase().split(':')[0] ?? '';
  const suffix = `.${rootDomain}`;
  if (!normalizedHost.endsWith(suffix)) return null;

  const label = normalizedHost.slice(0, -suffix.length);
  const result = validateSubdomain(label);
  return result.ok ? result.value : null;
}
