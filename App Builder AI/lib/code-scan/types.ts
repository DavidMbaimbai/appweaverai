export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = ['SECRET', 'CODE', 'DEPENDENCY', 'ACCESSIBILITY', 'PERFORMANCE'] as const;
export type Category = (typeof CATEGORIES)[number];

export type FindingStatus = 'OPEN' | 'ACKNOWLEDGED' | 'FIXED';

/** A project file offered to the scanners. `content` is null for binary or oversized files (size still counts). */
export type ScanFile = { path: string; size: number; content: string | null };

export type RawFinding = {
  rule: string;
  category: Category;
  severity: Severity;
  file: string;
  line: number | null;
  title: string;
  message: string;
  /** Redacted excerpt; scanners must never put a full secret here. */
  snippet?: string;
  /** Stable text the fingerprint is derived from (defaults to the snippet / line). */
  evidence?: string;
};

export type ScannedFinding = RawFinding & { fingerprint: string };

export type DependencyStatus = 'OK' | 'UNAVAILABLE' | 'SKIPPED';

export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

export function isBlockingSeverity(severity: string) {
  return severity === 'CRITICAL' || severity === 'HIGH';
}

export const MAX_SCAN_FILE_BYTES = 1_000_000;

export function lineOf(text: string, index: number) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function redactValue(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= 8) return `${clean.slice(0, 2)}…(${clean.length} chars)`;
  return `${clean.slice(0, 4)}…(${clean.length} chars)`;
}

export function isTestPath(path: string) {
  return /(^|\/)(__tests__|__mocks__|tests?|fixtures?|e2e|stories)\/|\.(test|spec|stories)\.[a-z]+$/i.test(path);
}
