import { createHash } from 'node:crypto';

import { checkDependencies, type DependencyResult, type OsvOptions } from './osv';
import { scanDangerousPatterns } from './patterns';
import { scanQuality } from './quality';
import { scanSecrets } from './secrets';
import {
  isBlockingSeverity,
  SEVERITY_RANK,
  type RawFinding,
  type ScanFile,
  type ScannedFinding,
} from './types';

const MAX_FINDINGS = 500;
const IGNORED = /(^|\/)(node_modules|\.git|\.next|\.turbo|coverage)\//;

export function fingerprintOf(finding: RawFinding, occurrence = 0) {
  const evidence = (finding.evidence ?? finding.snippet ?? '').replace(/\s+/g, ' ').trim();
  return createHash('sha256')
    .update(`${finding.rule}|${finding.file}|${evidence}|${occurrence}`)
    .digest('hex')
    .slice(0, 24);
}

export type ScanOutput = {
  findings: ScannedFinding[];
  filesScanned: number;
  dependencies: Pick<DependencyResult, 'status' | 'detail'>;
};

/** Runs every deterministic scanner over the files; dependency checks go to OSV.dev unless `skipDependencies`. */
export async function scanFiles(
  files: ScanFile[],
  options: { osv?: OsvOptions; skipDependencies?: boolean } = {},
): Promise<ScanOutput> {
  const candidates = files.filter((f) => !IGNORED.test(f.path));
  const raw: RawFinding[] = [];
  for (const file of candidates) {
    raw.push(...scanSecrets(file), ...scanDangerousPatterns(file), ...scanQuality(file));
  }

  let dependencies: Pick<DependencyResult, 'status' | 'detail'>;
  const pkg = candidates
    .filter((f) => /(^|\/)package\.json$/.test(f.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
  if (options.skipDependencies) {
    dependencies = { status: 'SKIPPED', detail: 'Dependency check was not requested.' };
  } else {
    const lockPath = pkg ? pkg.path.replace(/package\.json$/, 'package-lock.json') : null;
    const lock = candidates.find((f) => f.path === lockPath);
    const result = await checkDependencies(pkg?.content ?? null, lock?.content ?? null, options.osv);
    dependencies = { status: result.status, detail: result.detail };
    raw.push(...result.findings);
  }

  const seen = new Map<string, number>();
  const findings: ScannedFinding[] = raw
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
    .map((finding) => {
      const base = fingerprintOf(finding, 0);
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      return { ...finding, fingerprint: occurrence === 0 ? base : fingerprintOf(finding, occurrence) };
    })
    .slice(0, MAX_FINDINGS);

  return { findings, filesScanned: candidates.filter((f) => f.content !== null).length, dependencies };
}

export type CountsBySeverity = { critical: number; high: number; medium: number; low: number };

export function countBySeverity(findings: Array<{ severity: string }>): CountsBySeverity {
  const count = (s: string) => findings.filter((f) => f.severity === s).length;
  return { critical: count('CRITICAL'), high: count('HIGH'), medium: count('MEDIUM'), low: count('LOW') };
}

export type GateFinding = { id: string; severity: string; status: string; title: string; file: string; line: number | null };

/** Open HIGH/CRITICAL findings block publishing; acknowledged and fixed ones do not. */
export function decideScanGate(findings: GateFinding[]) {
  const blocking = findings.filter((f) => isBlockingSeverity(f.severity) && f.status === 'OPEN');
  return { blocked: blocking.length > 0, blocking };
}

export function formatScanGateError(blocking: GateFinding[]) {
  const shown = blocking
    .slice(0, 4)
    .map((f) => `${f.title} (${f.file}${f.line ? `:${f.line}` : ''})`)
    .join('; ');
  const more = blocking.length > 4 ? ` and ${blocking.length - 4} more` : '';
  return `Security scan found ${blocking.length} high/critical issue(s): ${shown}${more}. Fix them, or acknowledge each with a reason in the Security scan panel, then publish again.`;
}
