import { redactSensitive } from '@/lib/agents/untrusted';

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const SECRET_QUERY_PARAM = /([?&](?:token|access_token|api[_-]?key|key|secret|signature|sig|code)=)[^&\s]+/gi;

/** Masks secrets and personal data in free text before it leaves the process (logs, Sentry, alerts). */
export function scrubText(text: string): string {
  return redactSensitive(
    text.replace(URL_CREDENTIALS, '$1[redacted]@').replace(SECRET_QUERY_PARAM, '$1[redacted]'),
  );
}

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[_-]?key|credential|session|signature/i;
const MAX_DEPTH = 4;

/** Deep-copies structured context, dropping values under secret-looking keys and scrubbing every string. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value).slice(0, 1000);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (value instanceof Error) return scrubText(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrubValue(item, depth + 1);
  }
  return out;
}
