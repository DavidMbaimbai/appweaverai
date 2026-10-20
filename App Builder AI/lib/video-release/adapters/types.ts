import type { ReleasePlatform } from '../capabilities';

export type PublishInput = {
  releaseId: string;
  /** Stable per release; adapters use it where the platform supports client-side idempotency. */
  idempotencyKey: string;
  title: string;
  /** Final text for the platform: caption plus hashtags, already length-validated. */
  text: string;
  token: string;
  accountId: string | null;
  seconds: number;
  aspect: string;
  sizeBytes: number;
  /** Direct upload; downloads the bytes lazily so adapters that use a URL never buffer. */
  getBytes: () => Promise<Buffer>;
  /** Public URL Meta/TikTok can pull from; valid for `ttlSeconds`. */
  getPublicUrl: (ttlSeconds: number) => Promise<string>;
  /** True when automatic posts must stay private (unaudited TikTok app). */
  privateOnly: boolean;
};

/**
 * ok: the platform itself returned an id. Anything else is a failure and the
 * release is never marked PUBLISHED.
 *  - retryable: safe to try again (nothing was created).
 *  - authExpired: the token is revoked/expired; the owner must reconnect.
 *  - ambiguous: the request may have created the post; retrying could duplicate it.
 */
export type PublishResult =
  | { ok: true; externalId: string; postUrl: string | null; note?: string }
  | { ok: false; error: string; retryable: boolean; authExpired?: boolean; ambiguous?: boolean };

export interface VideoPublisher {
  platform: ReleasePlatform;
  publish(input: PublishInput): Promise<PublishResult>;
}

export const HTTP_TIMEOUT_MS = 60_000;
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

export function isAuthStatus(status: number) {
  return status === 401 || status === 403;
}

/** Maps an HTTP failure to a result; 5xx and 429 are retryable, 401 means reconnect. */
export async function httpFailure(response: Response, label: string): Promise<PublishResult> {
  const body = (await response.text().catch(() => '')).slice(0, 300);
  return {
    ok: false,
    error: `${label} ${response.status}: ${body}`,
    retryable: response.status >= 500 || response.status === 429,
    authExpired: response.status === 401,
  };
}

/** A thrown network error before any bytes were accepted is retryable. */
export function networkFailure(label: string, error: unknown, ambiguous = false): PublishResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: `${label}: ${message.slice(0, 250)}${ambiguous ? ' The post may have been created; check the account before retrying.' : ''}`,
    retryable: !ambiguous,
    ambiguous,
  };
}
