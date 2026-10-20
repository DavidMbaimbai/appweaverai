import type { DependencyStatus, RawFinding, Severity } from './types';

export const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
export const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns/';

const BATCH_SIZE = 500;
const MAX_PACKAGES = 1500;
const MAX_DETAIL_LOOKUPS = 60;
const LOOKUP_TTL_MS = 6 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;

export type Dependency = { name: string; version: string; dev: boolean };

export type DependencyResult = {
  status: DependencyStatus;
  detail: string;
  findings: RawFinding[];
  packagesChecked: number;
};

export type OsvOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  /** Packages-to-vulnerability-id cache; defaults to a process-wide cache. */
  cache?: OsvCache;
};

export type OsvCache = {
  lookups: Map<string, { at: number; ids: string[] }>;
  details: Map<string, { at: number; vuln: OsvVuln }>;
};

export function createOsvCache(): OsvCache {
  return { lookups: new Map(), details: new Map() };
}

const defaultCache = createOsvCache();

type OsvVuln = {
  id: string;
  aliases?: string[];
  summary?: string;
  severity?: Array<{ type: string; score: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>;
};

/** Reduces a semver range to the single version it most plausibly installs; null when it cannot be known. */
export function resolveVersion(range: string): string | null {
  const trimmed = range.trim();
  if (!trimmed || /^(latest|next|\*|x)$/i.test(trimmed)) return null;
  if (/^(git|github|file|link|workspace|http|https|npm):|^[\w.-]+\/[\w.-]+$/i.test(trimmed)) return null;
  const match = trimmed.match(/^(?:\^|~|>=|=|v)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
  if (match) return match[1];
  const loose = trimmed.match(/^(?:\^|~|>=|=|v)?\s*(\d+)(?:\.(\d+))?(?:\.x)?$/);
  if (loose) return `${loose[1]}.${loose[2] ?? '0'}.0`;
  return null;
}

export function extractDependencies(
  packageJson: string,
  lockJson?: string | null,
): { deps: Dependency[]; unresolved: string[]; error?: string } {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    return { deps: [], unresolved: [], error: 'package.json is not valid JSON.' };
  }
  const direct = new Map<string, boolean>();
  for (const name of Object.keys(pkg.devDependencies ?? {})) direct.set(name, true);
  for (const name of Object.keys(pkg.dependencies ?? {})) direct.set(name, false);

  const deps = new Map<string, Dependency>();
  const unresolved: string[] = [];

  if (lockJson) {
    try {
      const lock = JSON.parse(lockJson) as {
        packages?: Record<string, { version?: string; dev?: boolean; link?: boolean }>;
      };
      for (const [key, value] of Object.entries(lock.packages ?? {})) {
        const match = key.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/);
        if (!match || !value.version || value.link) continue;
        deps.set(`${match[1]}@${value.version}`, { name: match[1], version: value.version, dev: Boolean(value.dev) });
      }
    } catch {
      // Fall back to the declared ranges below.
    }
  }

  if (deps.size === 0) {
    for (const [name, isDev] of direct) {
      const range = (isDev ? pkg.devDependencies?.[name] : pkg.dependencies?.[name]) ?? '';
      const version = resolveVersion(range);
      if (version) deps.set(`${name}@${version}`, { name, version, dev: isDev });
      else unresolved.push(`${name}@${range}`);
    }
  }
  return { deps: Array.from(deps.values()).slice(0, MAX_PACKAGES), unresolved };
}

const CVSS_WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const;

/** CVSS v3.x base score from a vector string; null when the vector is not v3 or malformed. */
export function cvss3BaseScore(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const metrics = Object.fromEntries(vector.split('/').slice(1).map((part) => part.split(':') as [string, string]));
  const scopeChanged = metrics.S === 'C';
  const av = CVSS_WEIGHTS.AV[metrics.AV as keyof typeof CVSS_WEIGHTS.AV];
  const ac = CVSS_WEIGHTS.AC[metrics.AC as keyof typeof CVSS_WEIGHTS.AC];
  const ui = CVSS_WEIGHTS.UI[metrics.UI as keyof typeof CVSS_WEIGHTS.UI];
  const c = CVSS_WEIGHTS.CIA[metrics.C as keyof typeof CVSS_WEIGHTS.CIA];
  const i = CVSS_WEIGHTS.CIA[metrics.I as keyof typeof CVSS_WEIGHTS.CIA];
  const a = CVSS_WEIGHTS.CIA[metrics.A as keyof typeof CVSS_WEIGHTS.CIA];
  const pr =
    metrics.PR === 'N' ? 0.85 : metrics.PR === 'L' ? (scopeChanged ? 0.68 : 0.62) : metrics.PR === 'H' ? (scopeChanged ? 0.5 : 0.27) : undefined;
  if ([av, ac, ui, c, i, a, pr].some((v) => v === undefined) || (metrics.S !== 'C' && metrics.S !== 'U')) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * (pr as number) * ui;
  const raw = scopeChanged ? Math.min(1.08 * (impact + exploitability), 10) : Math.min(impact + exploitability, 10);
  return Math.ceil(raw * 10) / 10;
}

export function severityOfVuln(vuln: OsvVuln): Severity | null {
  const label = vuln.database_specific?.severity?.toUpperCase();
  if (label === 'CRITICAL' || label === 'HIGH' || label === 'LOW') return label;
  if (label === 'MODERATE' || label === 'MEDIUM') return 'MEDIUM';
  for (const entry of vuln.severity ?? []) {
    const score = cvss3BaseScore(entry.score);
    if (score === null) continue;
    return score >= 9 ? 'CRITICAL' : score >= 7 ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW';
  }
  return null;
}

class OsvUnavailable extends Error {}

async function osvFetch(impl: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  let response: Response;
  try {
    response = await impl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new OsvUnavailable(timedOut ? `OSV.dev did not answer within ${Math.round(timeoutMs / 1000)}s.` : 'OSV.dev could not be reached.');
  }
  if (!response.ok) throw new OsvUnavailable(`OSV.dev responded with HTTP ${response.status}.`);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new OsvUnavailable('OSV.dev returned an unreadable response.');
  }
}

function fixedVersion(vuln: OsvVuln): string | null {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) if (event.fixed) return event.fixed;
    }
  }
  return null;
}

function lineOfDependency(packageJson: string, name: string) {
  const index = packageJson.indexOf(`"${name}"`);
  if (index < 0) return null;
  return packageJson.slice(0, index).split('\n').length;
}

function cap(severity: Severity, dev: boolean): Severity {
  return dev && (severity === 'CRITICAL' || severity === 'HIGH') ? 'MEDIUM' : severity;
}

/**
 * Checks dependencies against OSV.dev. Never reports "clean" when OSV could not be queried:
 * the result is then `UNAVAILABLE` with a reason and no findings.
 */
export async function checkDependencies(
  packageJson: string | null,
  lockJson: string | null,
  options: OsvOptions = {},
): Promise<DependencyResult> {
  if (!packageJson) return { status: 'SKIPPED', detail: 'No package.json in the project.', findings: [], packagesChecked: 0 };
  const { deps, unresolved, error } = extractDependencies(packageJson, lockJson);
  if (error) return { status: 'SKIPPED', detail: error, findings: [], packagesChecked: 0 };
  if (deps.length === 0) {
    return {
      status: 'SKIPPED',
      detail: unresolved.length ? `No pinned versions to check (${unresolved.length} unresolvable).` : 'package.json declares no dependencies.',
      findings: [],
      packagesChecked: 0,
    };
  }

  const impl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const now = options.now ?? Date.now;
  const cache = options.cache ?? defaultCache;

  try {
    const idsByDep = new Map<string, string[]>();
    const toQuery: Dependency[] = [];
    for (const dep of deps) {
      const hit = cache.lookups.get(`${dep.name}@${dep.version}`);
      if (hit && now() - hit.at < LOOKUP_TTL_MS) idsByDep.set(`${dep.name}@${dep.version}`, hit.ids);
      else toQuery.push(dep);
    }

    for (let start = 0; start < toQuery.length; start += BATCH_SIZE) {
      const chunk = toQuery.slice(start, start + BATCH_SIZE);
      const body = JSON.stringify({
        queries: chunk.map((dep) => ({ package: { name: dep.name, ecosystem: 'npm' }, version: dep.version })),
      });
      const data = (await osvFetch(impl, OSV_BATCH_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, timeoutMs)) as {
        results?: Array<{ vulns?: Array<{ id: string }> }>;
      };
      if (!Array.isArray(data.results) || data.results.length !== chunk.length) {
        throw new OsvUnavailable('OSV.dev returned an unexpected response shape.');
      }
      chunk.forEach((dep, i) => {
        const ids = (data.results![i]?.vulns ?? []).map((v) => v.id);
        const key = `${dep.name}@${dep.version}`;
        idsByDep.set(key, ids);
        cache.lookups.set(key, { at: now(), ids });
      });
    }

    const allIds = Array.from(new Set(Array.from(idsByDep.values()).flat()));
    const vulns = new Map<string, OsvVuln | null>();
    let detailFailures = 0;
    for (const id of allIds.slice(0, MAX_DETAIL_LOOKUPS)) {
      const hit = cache.details.get(id);
      if (hit && now() - hit.at < DETAIL_TTL_MS) {
        vulns.set(id, hit.vuln);
        continue;
      }
      try {
        const vuln = (await osvFetch(impl, `${OSV_VULN_URL}${encodeURIComponent(id)}`, { method: 'GET' }, timeoutMs)) as OsvVuln;
        vulns.set(id, vuln);
        cache.details.set(id, { at: now(), vuln });
      } catch {
        detailFailures++;
        vulns.set(id, null);
      }
    }
    for (const id of allIds.slice(MAX_DETAIL_LOOKUPS)) vulns.set(id, null);

    const findings: RawFinding[] = [];
    for (const dep of deps) {
      const key = `${dep.name}@${dep.version}`;
      for (const id of idsByDep.get(key) ?? []) {
        const vuln = vulns.get(id) ?? null;
        // Unknown severity is treated as HIGH rather than hidden; the owner can acknowledge it.
        const base = (vuln && severityOfVuln(vuln)) ?? 'HIGH';
        const severity = cap(base, dep.dev);
        const fixed = vuln ? fixedVersion(vuln) : null;
        const aliases = vuln?.aliases?.filter((a) => a.startsWith('CVE-')).slice(0, 3).join(', ');
        findings.push({
          rule: `dependency/${id}`,
          category: 'DEPENDENCY',
          severity,
          file: 'package.json',
          line: lineOfDependency(packageJson, dep.name),
          title: `${dep.name}@${dep.version}: ${id}${aliases ? ` (${aliases})` : ''}`,
          message: `${vuln?.summary ?? 'Known vulnerability reported by OSV.dev.'}${fixed ? ` Fixed in ${fixed}.` : ''}${dep.dev ? ' Development-only dependency (severity capped).' : ''}${vuln && severityOfVuln(vuln) ? '' : ' Severity could not be determined and is treated as HIGH.'}`,
          snippet: key,
          evidence: `${id}:${key}`,
        });
      }
    }

    const notes = [
      detailFailures ? `${detailFailures} advisory detail lookup(s) failed` : '',
      allIds.length > MAX_DETAIL_LOOKUPS ? `severity not fetched for ${allIds.length - MAX_DETAIL_LOOKUPS} advisories` : '',
      unresolved.length ? `${unresolved.length} dependency range(s) could not be resolved to a version` : '',
    ].filter(Boolean);
    return {
      status: 'OK',
      detail: `Checked ${deps.length} package version(s) against OSV.dev; ${findings.length} advisory match(es).${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`,
      findings,
      packagesChecked: deps.length,
    };
  } catch (error) {
    if (error instanceof OsvUnavailable) {
      return { status: 'UNAVAILABLE', detail: `${error.message} Dependencies were NOT checked.`, findings: [], packagesChecked: 0 };
    }
    return { status: 'UNAVAILABLE', detail: 'Dependency check failed unexpectedly. Dependencies were NOT checked.', findings: [], packagesChecked: 0 };
  }
}
