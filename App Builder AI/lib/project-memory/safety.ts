import { FEATURE_STATES, LIMITS, MEMORY_TYPES, type FeatureState, type MemoryType } from './types';

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: 'API key', pattern: /\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}\b/ },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'access token', pattern: /\b(?:ghp|gho|ghs|github_pat|xox[abprs])[-_A-Za-z0-9]{20,}\b/ },
  { name: 'credential assignment', pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|bearer)\b["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i },
  { name: 'connection string with password', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@]{4,}@/i },
  { name: 'long hex or base64 secret', pattern: /\b(?:[A-Fa-f0-9]{40,}|[A-Za-z0-9+/]{48,}={0,2})\b/ },
];

/** Name of the first secret-looking pattern in the text, or null. */
export function detectSecret(text: string): string | null {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function clean(text: string) {
  return text.replace(/\u0000/g, '').replace(/\r\n/g, '\n').replace(EMAIL, '[redacted-email]').trim();
}

export function normaliseFilePath(value: string) {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

export type MemoryInput = {
  type: string;
  title: string;
  body: string;
  files?: string[];
  featureState?: string | null;
  confidence?: number;
};

export type CleanMemoryInput = {
  type: MemoryType;
  title: string;
  body: string;
  files: string[];
  featureState: FeatureState | null;
  confidence: number;
};

/** Validates and cleans an entry; entries containing secrets are rejected outright, never stored redacted. */
export function sanitiseMemoryInput(input: MemoryInput): { ok: true; value: CleanMemoryInput } | { ok: false; error: string } {
  if (!(MEMORY_TYPES as readonly string[]).includes(input.type)) return { ok: false, error: 'Unknown memory type.' };
  const title = clean(String(input.title ?? '')).replace(/\s+/g, ' ');
  const body = clean(String(input.body ?? ''));
  if (title.length < 3) return { ok: false, error: 'Title is too short.' };
  if (body.length < 3) return { ok: false, error: 'Body is too short.' };
  const files = (input.files ?? []).map(normaliseFilePath).filter(Boolean);
  const secret = detectSecret(`${title}\n${body}\n${files.join('\n')}`);
  if (secret) {
    return { ok: false, error: `Rejected: looks like it contains a secret (${secret}). Memory never stores credentials.` };
  }
  const featureState =
    input.type === 'FEATURE_STATUS'
      ? (FEATURE_STATES as readonly string[]).includes(input.featureState ?? '')
        ? (input.featureState as FeatureState)
        : 'COMPLETED'
      : null;
  const confidence = Number.isFinite(input.confidence) ? Math.min(1, Math.max(0, Number(input.confidence))) : 0.7;
  return {
    ok: true,
    value: {
      type: input.type as MemoryType,
      title: title.slice(0, LIMITS.titleMax),
      body: body.slice(0, LIMITS.bodyMax),
      files: Array.from(new Set(files)).slice(0, LIMITS.filesMax),
      featureState,
      confidence,
    },
  };
}
