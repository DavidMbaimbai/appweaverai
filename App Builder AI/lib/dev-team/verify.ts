import { decideScanGate, scanFiles, type ScanOutput } from '@/lib/code-scan/scan';
import { isBlockingSeverity, type ScanFile, type ScannedFinding } from '@/lib/code-scan/types';

import type { MergeResult } from './merge';

export type VerificationFinding = { severity: string; rule: string; file: string; line: number | null; title: string };

export type VerificationResult = {
  /** Static scan of the merged result compared with the files as they are today. */
  scan:
    | { status: 'PASSED' | 'BLOCKED'; filesScanned: number; newFindings: VerificationFinding[]; dependencies: string }
    | { status: 'NOT_RUN'; reason: string };
  /** The project's tests/build run in a sandbox on saved files; unapplied proposals cannot be tested there, so this is never "passed" here. */
  regression: { status: 'NOT_RUN'; reason: string; baseline: { status: string; createdAt: string } | null };
  protectedTouched: Array<{ title: string; files: string[] }>;
  unresolvedFiles: string[];
  staleFiles: string[];
  /** Hard blockers: approval is refused while any exist. */
  blockers: string[];
  /** Things the approver must explicitly acknowledge. */
  warnings: string[];
  canApprove: boolean;
  verifiedAt: string;
};

export const REGRESSION_NOT_RUN_REASON =
  'The regression check (tests/build) runs on saved project files, not on proposals that are not applied yet, so it was not run. After applying, run it from the Quality page.';

const SCANNABLE = /\.(html?|css|scss|m?[jt]sx?|cjs|vue|svelte|json|md|txt|xml|svg|py|php|rb|ya?ml|toml|sh|ini|conf|env|sql|prisma)$|(^|\/)(Dockerfile[\w.-]*)$/i;

const toScanFile = (path: string, content: string | null): ScanFile => ({ path, size: content ? Buffer.byteLength(content) : 0, content });

export type PureVerifyInput = {
  files: Array<Pick<MergeResult, 'path' | 'op' | 'baseContent' | 'finalContent'> & { status: MergeResult['status'] | 'STALE' | 'RESOLVED' | 'APPLIED' }>;
  protectedFeatures: Array<{ title: string; files: string[] }>;
  matchesProtectedPath: (entry: string, filePath: string) => boolean;
  baselineRegression: { status: string; createdAt: string } | null;
  scan?: (files: ScanFile[], options: { skipDependencies: boolean }) => Promise<ScanOutput>;
  now?: Date;
};

const brief = (f: ScannedFinding): VerificationFinding => ({ severity: f.severity, rule: f.rule, file: f.file, line: f.line, title: f.title });

/** Runs the existing code-scan scanners on the merged result and reports ONLY findings the change introduces. */
export async function verifyMerged(input: PureVerifyInput): Promise<VerificationResult> {
  const unresolvedFiles = input.files.filter((f) => f.status === 'CONFLICT').map((f) => f.path);
  const staleFiles = input.files.filter((f) => f.status === 'STALE').map((f) => f.path);
  const applicable = input.files.filter((f) => f.status !== 'CONFLICT' && f.status !== 'STALE');

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (input.files.length === 0) blockers.push('There are no file changes to apply.');
  if (unresolvedFiles.length > 0) blockers.push(`${unresolvedFiles.length} file(s) have unresolved conflicts: ${unresolvedFiles.join(', ')}.`);
  if (staleFiles.length > 0) blockers.push(`${staleFiles.length} file(s) changed after the AI team read them: ${staleFiles.join(', ')}. Run the team again.`);

  const protectedTouched = input.protectedFeatures
    .map((feature) => ({ title: feature.title, files: applicable.filter((f) => feature.files.some((entry) => input.matchesProtectedPath(entry, f.path))).map((f) => f.path) }))
    .filter((feature) => feature.files.length > 0);
  if (protectedTouched.length > 0) warnings.push(`Touches protected features: ${protectedTouched.map((p) => p.title).join(', ')}.`);

  let scan: VerificationResult['scan'];
  const toScan = applicable.filter((f) => f.op !== 'DELETE' && f.finalContent !== null && SCANNABLE.test(f.path));
  if (toScan.length === 0) {
    scan = { status: 'NOT_RUN', reason: applicable.length === 0 ? 'Nothing to scan.' : 'None of the changed files are scannable text files.' };
    warnings.push('The security scan did not run on these changes.');
  } else {
    try {
      const run = input.scan ?? ((files, options) => scanFiles(files, options));
      const touchesPackage = toScan.some((f) => /(^|\/)package\.json$/.test(f.path));
      const after = await run(toScan.map((f) => toScanFile(f.path, f.finalContent)), { skipDependencies: !touchesPackage });
      const before = await run(
        toScan.filter((f) => f.baseContent !== null).map((f) => toScanFile(f.path, f.baseContent)),
        { skipDependencies: true },
      );
      const known = new Set(before.findings.map((f) => f.fingerprint));
      const added = after.findings.filter((f) => !known.has(f.fingerprint));
      const gate = decideScanGate(added.map((f, i) => ({ id: String(i), severity: f.severity, status: 'OPEN', title: f.title, file: f.file, line: f.line })));
      scan = {
        status: gate.blocked ? 'BLOCKED' : 'PASSED',
        filesScanned: after.filesScanned,
        newFindings: added.filter((f) => f.severity !== 'INFO').slice(0, 30).map(brief),
        dependencies: after.dependencies.status === 'OK' ? 'Dependencies checked.' : `Dependency check: ${after.dependencies.status.toLowerCase()}.`,
      };
      if (gate.blocked) blockers.push(`The change introduces ${gate.blocking.length} high/critical security finding(s).`);
      else if (added.some((f) => !isBlockingSeverity(f.severity) && f.severity !== 'INFO')) warnings.push('The change introduces lower-severity scan findings.');
    } catch {
      scan = { status: 'NOT_RUN', reason: 'The scanner failed to run. Nothing was verified.' };
      warnings.push('The security scan failed to run, so these changes were not scanned.');
    }
  }

  const regression = { status: 'NOT_RUN' as const, reason: REGRESSION_NOT_RUN_REASON, baseline: input.baselineRegression };
  warnings.push('Tests/build were not run on these changes.');

  return {
    scan,
    regression,
    protectedTouched,
    unresolvedFiles,
    staleFiles,
    blockers,
    warnings,
    canApprove: blockers.length === 0,
    verifiedAt: (input.now ?? new Date()).toISOString(),
  };
}
