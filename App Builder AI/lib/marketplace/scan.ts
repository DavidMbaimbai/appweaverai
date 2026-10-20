import { scanFiles } from '@/lib/code-scan/scan';
import { detectInjection } from '@/lib/agents/untrusted';
import { redactValue } from '@/lib/code-scan/types';

import { installFilesOf, type Bundle } from './bundle';

export type ScanVerdict = 'clean' | 'flagged' | 'blocked';

export type MarketplaceFinding = {
  rule: string;
  severity: string;
  file: string;
  line: number | null;
  title: string;
  snippet?: string;
};

export type BundleScanResult = {
  verdict: ScanVerdict;
  findings: MarketplaceFinding[];
  filesScanned: number;
};

const CODE_FILE = /\.(m?jsx?|tsx?|html?|svg|sql|ya?ml|json)$/i;

type MalwareRule = { rule: string; severity: 'HIGH' | 'MEDIUM'; title: string; test: RegExp; files?: RegExp };

// Marketplace-specific checks on top of lib/code-scan: things a shared asset should never do.
const MALWARE_RULES: MalwareRule[] = [
  { rule: 'market/child-process', severity: 'HIGH', title: 'Spawns operating-system processes', test: /\bchild_process\b|\b(?:exec|execSync|spawn|spawnSync|execFile)\s*\(/ },
  { rule: 'market/obfuscated-eval', severity: 'HIGH', title: 'Decodes and executes hidden code', test: /\b(?:eval|Function)\s*\(\s*(?:atob|Buffer\.from|unescape|decodeURIComponent)\s*\(/ },
  { rule: 'market/char-code-blob', severity: 'HIGH', title: 'Long String.fromCharCode blob (obfuscation)', test: /String\.fromCharCode\((?:\s*\d+\s*,){20,}/ },
  { rule: 'market/pipe-to-shell', severity: 'HIGH', title: 'Downloads and pipes into a shell', test: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/, files: /\.(?:json|ya?ml|sql|m?[jt]sx?)$/i },
  { rule: 'market/install-script', severity: 'HIGH', title: 'package.json install lifecycle script', test: /"(?:pre|post)?install"\s*:/, files: /(^|\/)package\.json$/ },
  { rule: 'market/remote-code-import', severity: 'HIGH', title: 'Imports code from a remote URL', test: /\bimport\s*\(\s*["'`]https?:|\bimport\s+[^;\n]*from\s*["']https?:/ },
  { rule: 'market/cookie-exfil', severity: 'HIGH', title: 'Reads cookies or storage and sends them out', test: /(?:document\.cookie|localStorage|sessionStorage)[^\n]{0,120}\b(?:fetch|sendBeacon|XMLHttpRequest)\b|\b(?:fetch|sendBeacon)\b[^\n]{0,120}(?:document\.cookie|localStorage|sessionStorage)/ },
  { rule: 'market/base64-blob', severity: 'MEDIUM', title: 'Large base64 blob', test: /[A-Za-z0-9+/]{400,}={0,2}/ },
];

/**
 * Deterministic safety scan of an untrusted bundle: reuses the project code scanner (secrets, dangerous patterns)
 * and adds marketplace rules. No AI is involved and nothing in the bundle is executed or trusted.
 * Any secret or HIGH/CRITICAL finding blocks submission; MEDIUM findings and instruction-like text go to a human reviewer.
 */
export async function scanBundle(bundle: Bundle): Promise<BundleScanResult> {
  const files = installFilesOf(bundle);
  const scan = await scanFiles(
    files.map((f) => ({ path: f.path, size: Buffer.byteLength(f.content), content: f.content })),
    { skipDependencies: true },
  );

  const findings: MarketplaceFinding[] = scan.findings.map((f) => ({
    rule: f.rule,
    severity: f.severity,
    file: f.file,
    line: f.line,
    title: f.title,
    snippet: f.category === 'SECRET' ? (f.snippet ? redactValue(f.snippet) : undefined) : f.snippet,
  }));

  for (const file of files) {
    const lines = file.content.split('\n');
    for (const rule of MALWARE_RULES) {
      if (rule.files ? !rule.files.test(file.path) : !CODE_FILE.test(file.path)) continue;
      const index = lines.findIndex((line) => rule.test.test(line));
      if (index >= 0) findings.push({ rule: rule.rule, severity: rule.severity, file: file.path, line: index + 1, title: rule.title });
    }
  }

  const injection = detectInjection(files.map((f) => f.content).join('\n'));
  for (const name of injection) {
    findings.push({ rule: `market/prompt-injection:${name}`, severity: 'MEDIUM', file: '(bundle)', line: null, title: 'Instruction-like text aimed at an AI agent' });
  }

  const blocked = findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH' || f.rule.startsWith('secret/'));
  const flagged = findings.some((f) => f.severity === 'MEDIUM');
  return {
    verdict: blocked ? 'blocked' : flagged ? 'flagged' : 'clean',
    findings: findings.slice(0, 100),
    filesScanned: scan.filesScanned,
  };
}
