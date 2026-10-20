import { isTestPath, redactValue, type RawFinding, type ScanFile } from './types';

type Known = { rule: string; name: string; pattern: RegExp; severity: 'CRITICAL' | 'HIGH' };

const KNOWN: Known[] = [
  { rule: 'secret/aws-access-key', name: 'AWS access key ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: 'CRITICAL' },
  { rule: 'secret/stripe-live-key', name: 'Stripe live secret key', pattern: /\b[sr]k_live_[0-9A-Za-z]{16,}\b/g, severity: 'CRITICAL' },
  { rule: 'secret/stripe-test-key', name: 'Stripe test secret key', pattern: /\b[sr]k_test_[0-9A-Za-z]{16,}\b/g, severity: 'HIGH' },
  { rule: 'secret/anthropic-key', name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: 'CRITICAL' },
  { rule: 'secret/openai-key', name: 'OpenAI API key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g, severity: 'CRITICAL' },
  { rule: 'secret/github-token', name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g, severity: 'CRITICAL' },
  { rule: 'secret/slack-token', name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, severity: 'CRITICAL' },
  { rule: 'secret/sendgrid-key', name: 'SendGrid API key', pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, severity: 'CRITICAL' },
  { rule: 'secret/twilio-key', name: 'Twilio API key', pattern: /\bSK[0-9a-f]{32}\b/g, severity: 'HIGH' },
  { rule: 'secret/google-oauth-secret', name: 'Google OAuth client secret', pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g, severity: 'CRITICAL' },
  { rule: 'secret/private-key', name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, severity: 'CRITICAL' },
];

const PLACEHOLDER =
  /example|your[_-]?|xxxx|\*{3,}|placeholder|changeme|change[_-]me|dummy|sample|<[^>]+>|\$\{|\{\{|process\.env|todo|redacted|insert[_-]|replace[_-]/i;

export function isPlaceholder(value: string) {
  if (PLACEHOLDER.test(value)) return true;
  if (/^(.)\1+$/.test(value)) return true;
  return false;
}

export function shannonEntropy(value: string) {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const SERVER_PATH = /(^|\/)(api|server|servers|backend|functions|scripts)\//i;
const SERVER_CODE =
  /from\s+['"](?:node:[a-z/]+|fs|path|child_process|http|https|crypto|os)['"]|require\(\s*['"](?:node:)?(?:fs|path|child_process|http|https|express|crypto)['"]\s*\)|next\/server|['"]use server['"]/;
const CLIENT_CODE = /['"]use client['"]|\b(?:document|window|localStorage|sessionStorage)\./;

/** True when the file is shipped to (or executes in) the visitor's browser. */
export function isClientSide(file: { path: string; content: string }) {
  const path = file.path.toLowerCase();
  if (/\.html?$/.test(path)) return true;
  if (/(^|\/)public\//.test(path) || /(^|\/)(static|assets)\//.test(path)) return true;
  if (!/\.(m?jsx?|tsx?|vue|svelte)$/.test(path)) return false;
  if (SERVER_PATH.test(path) || /(^|\/)route\.[jt]s$/.test(path)) return false;
  if (SERVER_CODE.test(file.content)) return false;
  return CLIENT_CODE.test(file.content) || /\.(jsx|tsx|vue|svelte)$/.test(path);
}

function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

const GENERIC_ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|apikey|private[_-]?key|access[_-]?key|credentials?)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*["'`]([A-Za-z0-9/+_=.~-]{16,})["'`]/gi;
const SAFE_KEY = /public|publishable|site[_-]?key|csrf|nonce|recaptcha|client[_-]?id|measurement|sentry[_-]?dsn|salt$/i;
const DB_URL =
  /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/([^:\s/@"'`]+):([^@\s"'`]+)@([^\s/"'`:?]+)/gi;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal|db|postgres|redis|mongo)$/i;
const SERVER_ENV_IN_CLIENT =
  /process\.env\.(?:(?!NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_)[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|API_KEY|ACCESS_KEY|DATABASE_URL|TOKEN)[A-Z0-9_]*)/;
const PUBLIC_ENV_SECRET =
  /(?:process\.env\.|import\.meta\.env\.)(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_)[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|DATABASE_URL)[A-Z0-9_]*/;
const PROVIDER_HOST = /https?:\/\/api\.(?:openai\.com|anthropic\.com|stripe\.com|sendgrid\.com|twilio\.com|mailgun\.net|resend\.com)\b/;
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$|\.map$/i;
const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/i;
const ENV_TEMPLATE = /\.(example|sample|template|defaults?)$/i;

function snippetFor(line: string, secret: string) {
  const trimmed = line.trim().slice(0, 160);
  return trimmed.split(secret).join(redactValue(secret));
}

export function scanSecrets(file: ScanFile): RawFinding[] {
  if (file.content === null || SKIP_FILES.test(file.path)) return [];
  const content = file.content;
  const out: RawFinding[] = [];
  const client = isClientSide({ path: file.path, content });
  const where = client ? ' This file is delivered to every visitor’s browser.' : '';
  const test = isTestPath(file.path);
  const isEnv = ENV_FILE.test(file.path) && !ENV_TEMPLATE.test(file.path);
  const lines = content.split('\n');
  const seenOnLine = new Set<string>();

  const add = (finding: RawFinding, dedupeKey: string) => {
    if (seenOnLine.has(dedupeKey)) return;
    seenOnLine.add(dedupeKey);
    out.push(finding);
  };

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (line.length > 4000) return;

    for (const known of KNOWN) {
      known.pattern.lastIndex = 0;
      for (const match of line.matchAll(known.pattern)) {
        const value = match[0];
        if (/EXAMPLE/.test(value) || isPlaceholder(value)) continue;
        add(
          {
            rule: known.rule,
            category: 'SECRET',
            severity: known.severity,
            file: file.path,
            line: lineNo,
            title: `${known.name} in project files`,
            message: `A ${known.name} is hard-coded.${where} Remove it, rotate the credential, and keep it in an environment variable used only on a server.`,
            snippet: snippetFor(line, value),
            evidence: `${known.rule}:${value}`,
          },
          `${lineNo}:${known.rule}:${value}`,
        );
      }
    }

    for (const match of line.matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g)) {
      if (jwtRole(match[0]) === 'service_role') {
        add(
          {
            rule: 'secret/supabase-service-role',
            category: 'SECRET',
            severity: 'CRITICAL',
            file: file.path,
            line: lineNo,
            title: 'Supabase service-role key in project files',
            message: `A JWT with role "service_role" bypasses all row-level security.${where} Remove it and rotate the key.`,
            snippet: snippetFor(line, match[0]),
            evidence: `jwt:${match[0]}`,
          },
          `${lineNo}:jwt:${match[0]}`,
        );
      }
    }

    for (const match of line.matchAll(DB_URL)) {
      const [, scheme, user, password, host] = match;
      if (LOCAL_HOST.test(host) || isPlaceholder(password) || isPlaceholder(user) || /^(pass(word)?|user|secret)$/i.test(password)) continue;
      add(
        {
          rule: 'secret/database-url',
          category: 'SECRET',
          severity: 'CRITICAL',
          file: file.path,
          line: lineNo,
          title: 'Database connection string with credentials',
          message: `A ${scheme} connection string with an embedded password is hard-coded.${where} Move it to an environment variable and rotate the password.`,
          snippet: snippetFor(line, password),
          evidence: `dburl:${host}:${user}:${password}`,
        },
        `${lineNo}:dburl`,
      );
    }

    if (client) {
      const pub = line.match(PUBLIC_ENV_SECRET);
      if (pub) {
        add(
          {
            rule: 'secret/public-env-secret',
            category: 'SECRET',
            severity: 'HIGH',
            file: file.path,
            line: lineNo,
            title: 'Secret exposed through a public environment variable',
            message: `${pub[0]} is inlined into browser code at build time, so its value is public. Rename it without the public prefix and use it only on a server.`,
            snippet: line.trim().slice(0, 160),
            evidence: pub[0],
          },
          `${lineNo}:pubenv`,
        );
      }
      const serverEnv = line.match(SERVER_ENV_IN_CLIENT);
      if (serverEnv) {
        add(
          {
            rule: 'secret/server-env-in-client',
            category: 'SECRET',
            severity: 'HIGH',
            file: file.path,
            line: lineNo,
            title: 'Server-only credential referenced in client code',
            message: `${serverEnv[0]} is a server credential but this file runs in the browser. Move the call that needs it to a server route and call that route instead.`,
            snippet: line.trim().slice(0, 160),
            evidence: serverEnv[0],
          },
          `${lineNo}:serverenv`,
        );
      }
      if (PROVIDER_HOST.test(line)) {
        const nearby = lines.slice(Math.max(0, idx - 8), idx + 9).join('\n');
        if (/bearer|authorization|x-api-key|api[-_]?key|[?&]key=/i.test(nearby)) {
          add(
            {
              rule: 'secret/provider-call-from-client',
              category: 'SECRET',
              severity: 'HIGH',
              file: file.path,
              line: lineNo,
              title: 'Provider API called with credentials from the browser',
              message: `This browser code calls a third-party API that needs a secret key.${where} Anyone can read the key in the page. Proxy the call through a server route that holds the key.`,
              snippet: line.trim().slice(0, 160),
              evidence: line.trim(),
            },
            `${lineNo}:providercall`,
          );
        }
      }
    }

    if (test) return;

    GENERIC_ASSIGNMENT.lastIndex = 0;
    for (const match of line.matchAll(GENERIC_ASSIGNMENT)) {
      const [, key, value] = match;
      if (SAFE_KEY.test(key) || isPlaceholder(value)) continue;
      if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) continue;
      if (shannonEntropy(value) < 3.4) continue;
      if (/^[A-Za-z0-9_-]+\.[a-z]{2,4}$/.test(value)) continue;
      if (KNOWN.some((k) => { k.pattern.lastIndex = 0; return k.pattern.test(value); })) continue;
      add(
        {
          rule: 'secret/high-entropy-assignment',
          category: 'SECRET',
          severity: client || isEnv ? 'HIGH' : 'MEDIUM',
          file: file.path,
          line: lineNo,
          title: 'Hard-coded credential-like value',
          message: `\`${key}\` is assigned a high-entropy literal.${where}${isEnv ? ' Environment files are not meant to be published with the site.' : ''} If this is a real credential, remove and rotate it and read it from an environment variable.`,
          snippet: snippetFor(line, value),
          evidence: `${key}:${value}`,
        },
        `${lineNo}:generic:${key}`,
      );
    }
  });

  if (out.length === 0 && isEnv) {
    const hasValue = lines.some((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S+/.test(l) && !l.trim().startsWith('#'));
    if (hasValue) {
      out.push({
        rule: 'secret/env-file-present',
        category: 'SECRET',
        severity: 'MEDIUM',
        file: file.path,
        line: null,
        title: 'Environment file in project files',
        message: 'Environment files hold credentials and should not be part of the project files. Use the project’s environment variable settings instead.',
        evidence: 'env-file',
      });
    }
  }

  return out.slice(0, 50);
}
