import type { HttpFn, TestResult } from './types';

type ProbeOptions = {
  fetch: HttpFn;
  url: string;
  init?: RequestInit;
  /** Name shown to the user, e.g. "Stripe". */
  service: string;
  /** Extra success predicate on the JSON body (e.g. Slack's `ok`). */
  accept?: (body: unknown) => boolean | string;
  successMessage: string;
  timeoutMs?: number;
};

/** One read-only request. Messages never echo credentials or raw provider bodies. */
export async function probe(options: ProbeOptions): Promise<TestResult> {
  const { fetch: doFetch, url, init, service, accept, successMessage, timeoutMs = 10_000 } = options;
  let response: Response;
  try {
    response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch {
    return { ok: false, message: `Could not reach ${service}. Check your network or try again.` };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: `${service} rejected the credentials (HTTP ${response.status}). Check the key and its permissions.` };
  }
  if (response.status === 429) return { ok: false, message: `${service} is rate limiting requests. Try again shortly.` };
  if (!response.ok) return { ok: false, message: `${service} responded with HTTP ${response.status}.` };
  if (accept) {
    const body = await response.json().catch(() => null);
    const verdict = accept(body);
    if (verdict !== true) {
      return { ok: false, message: typeof verdict === 'string' ? verdict : `${service} did not accept the credentials.` };
    }
  }
  return { ok: true, message: successMessage };
}

export const bearer = (token: string): HeadersInit => ({ authorization: `Bearer ${token}` });
