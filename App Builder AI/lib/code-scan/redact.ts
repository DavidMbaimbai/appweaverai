import { redactSensitive } from '@/lib/agents';

export const MAX_DIAGNOSIS_INPUT_CHARS = 8000;

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi;
const SECRET_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|DATABASE_URL)[A-Z0-9_]*)(\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/g;
const HOME_PATH = /(?:\/home\/|\/Users\/|C:\\Users\\)[^\s/\\:]+/g;

/**
 * Cleans build/deploy/test output before it is stored or sent to a model:
 * strips terminal colour codes, credentials in URLs, secret-looking env assignments,
 * provider keys, emails/phones and user home paths, then keeps the tail (where errors usually are).
 */
export function redactLogForDiagnosis(raw: string, maxChars = MAX_DIAGNOSIS_INPUT_CHARS): string {
  let text = raw.replace(/\u0000/g, '').replace(ANSI, '');
  text = text.replace(URL_CREDENTIALS, '$1[redacted]@');
  text = text.replace(SECRET_ASSIGNMENT, '$1$2[redacted]');
  text = text.replace(HOME_PATH, '[home]');
  text = redactSensitive(text);
  if (text.length > maxChars) text = `… (earlier output omitted)\n${text.slice(text.length - maxChars)}`;
  return text.trim();
}
