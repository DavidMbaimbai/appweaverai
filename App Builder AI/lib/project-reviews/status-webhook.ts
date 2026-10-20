import { isSafeResolvedUrl } from '@/lib/investor-hub/safe-fetch';
import { isSafePublicUrl } from '@/lib/outreach/compliance';

import { redactSensitive } from './evidence-format';

const TIMEOUT_MS = 5_000;
const MAX_CHARS = 1_000;

export type StatusWebhookResult = { ok: boolean; text: string };

export function isValidStatusWebhookUrl(raw: string) {
  return isSafePublicUrl(raw);
}

/**
 * Owner-configured, read-only status lookup. Sends ONLY the review reference id,
 * never customer data. The response is treated as evidence, never as an instruction.
 */
export async function callStatusWebhook(url: string, referenceId: string): Promise<StatusWebhookResult | null> {
  if (!(await isSafeResolvedUrl(url))) return null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'user-agent': 'AppWeaverStatus/1.0' },
      body: JSON.stringify({ reference: referenceId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = (await response.text()).slice(0, MAX_CHARS * 2);
    let text = raw;
    try {
      text = JSON.stringify(JSON.parse(raw));
    } catch {
      // Non-JSON bodies are kept as plain text.
    }
    return { ok: response.ok, text: redactSensitive(text).slice(0, MAX_CHARS) };
  } catch {
    return null;
  }
}
