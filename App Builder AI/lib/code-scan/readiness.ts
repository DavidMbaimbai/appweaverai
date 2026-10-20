import type { CheckResult } from '@/lib/launch-readiness/checks';

import type { StoredScan } from './service';

/** Launch-readiness check derived from a stored scan. Honest about what was and was not inspected. */
export function checkCodeScan(scan: StoredScan | null): CheckResult {
  const title = 'Security and quality scan';
  if (!scan) {
    return {
      id: 'code_scan',
      title,
      status: 'NOT_VERIFIED',
      evidence: 'No security scan has been run for this project.',
      advice: 'Run the Security scan from the project menu.',
    };
  }
  const open = scan.findings.filter((f) => f.status === 'OPEN');
  const blocking = open.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const acknowledged = scan.findings.filter((f) => f.status === 'ACKNOWLEDGED' && (f.severity === 'CRITICAL' || f.severity === 'HIGH'));
  const depNote =
    scan.depStatus === 'UNAVAILABLE'
      ? ' Dependencies could NOT be checked (vulnerability database unreachable).'
      : scan.depStatus === 'SKIPPED'
        ? ' No dependency manifest was checked.'
        : '';

  if (blocking.length > 0) {
    return {
      id: 'code_scan',
      title,
      status: 'FAIL',
      evidence: `${blocking.length} open high/critical finding(s): ${blocking
        .slice(0, 3)
        .map((f) => `${f.title} (${f.file})`)
        .join('; ')}${blocking.length > 3 ? ` and ${blocking.length - 3} more` : ''}.${depNote}`,
      advice: 'Fix each finding, or acknowledge it with a reason in the Security scan panel.',
    };
  }
  const medium = open.filter((f) => f.severity === 'MEDIUM').length;
  if (medium > 0 || acknowledged.length > 0 || scan.depStatus === 'UNAVAILABLE') {
    return {
      id: 'code_scan',
      title,
      status: 'WARN',
      evidence: `${medium} open medium finding(s); ${acknowledged.length} high/critical finding(s) acknowledged by the owner.${depNote}`,
      advice: 'Review the medium findings and re-run the scan when the dependency database is reachable.',
    };
  }
  return {
    id: 'code_scan',
    title,
    status: 'PASS',
    evidence: `No open high/critical findings in ${scan.filesScanned} scanned file(s).${depNote} This is an automated pattern scan, not a security audit.`,
  };
}
