import { createHash, timingSafeEqual } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';

import { getIntegration } from './catalogue';
import {
  buildAuthHeaders,
  filterCallerHeaders,
  parseConnectorConfig,
  resolveConnectorUrl,
  type HttpMethod,
} from './connector';
import { decryptConnection, getProxyToken, recordUsage } from './service';
import { createSafeFetch, SsrfError, validateOutboundUrl } from './ssrf';

export const PROXY_RATE_PER_MINUTE = 60;
export const PROXY_DAILY_QUOTA = 5_000;
export const MAX_PROXY_REQUEST_BYTES = 1_000_000;

export type ProxyResult =
  | { ok: true; status: number; body: unknown; contentType: string | null }
  | { ok: false; httpStatus: number; error: string; retryAfter?: number };

const digest = (value: string) => createHash('sha256').update(value).digest();

export function tokenMatches(expected: string | null, provided: string) {
  if (!expected || !provided) return false;
  return timingSafeEqual(digest(expected), digest(provided));
}

type Payload = {
  method?: unknown;
  path?: unknown;
  query?: unknown;
  headers?: unknown;
  body?: unknown;
};

export async function executeProxy(
  input: { connectionId: string; bearer: string; payload: Payload },
  deps: { safeFetch?: typeof fetch } = {},
): Promise<ProxyResult> {
  const row = await prisma.integrationConnection.findUnique({ where: { id: input.connectionId } });
  const expected = row ? await getProxyToken(row.projectId) : null;
  // Same answer for "no such connection" and "bad token" so connection ids cannot be probed.
  if (!row || !tokenMatches(expected, input.bearer)) return { ok: false, httpStatus: 401, error: 'Unauthorized.' };

  const def = getIntegration(row.integrationId);
  if (!def?.userDefinedUrl) return { ok: false, httpStatus: 404, error: 'This integration cannot be proxied.' };
  const override = await prisma.integrationCatalogueOverride.findUnique({ where: { integrationId: def.id } });
  if (override?.disabled) return { ok: false, httpStatus: 403, error: 'This integration is temporarily disabled.' };

  const minute = await rateLimit(`integration-proxy:${row.id}`, PROXY_RATE_PER_MINUTE, 60_000);
  if (!minute.ok) return { ok: false, httpStatus: 429, error: 'Too many requests.', retryAfter: minute.retryAfter };
  const usedToday = await prisma.integrationApiLog.count({
    where: { projectId: row.projectId, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  if (usedToday >= PROXY_DAILY_QUOTA) {
    return { ok: false, httpStatus: 429, error: 'Daily proxy quota for this project is used up.', retryAfter: 3_600 };
  }

  const loaded = decryptConnection(row, def);
  if (!loaded) return { ok: false, httpStatus: 500, error: 'The stored credential could not be read. Reconnect the integration.' };
  const config = parseConnectorConfig(loaded.values);

  const graphql = def.id === 'graphql-api';
  const method = (graphql ? 'POST' : String(input.payload.method ?? 'GET').toUpperCase()) as HttpMethod;
  if (!config.allowedMethods.includes(method) && !graphql) {
    return { ok: false, httpStatus: 403, error: `Method ${method} is not allowed for this connection.` };
  }

  let url: string;
  if (graphql) {
    const checked = validateOutboundUrl(config.baseUrl);
    if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.reason };
    url = checked.url.toString();
  } else {
    const query =
      input.payload.query && typeof input.payload.query === 'object'
        ? (Object.fromEntries(
            Object.entries(input.payload.query as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
          ) as Record<string, string>)
        : undefined;
    const resolved = resolveConnectorUrl(config, String(input.payload.path ?? ''), query);
    if (!resolved.ok) return { ok: false, httpStatus: 403, error: resolved.reason };
    url = resolved.url;
  }

  const headers = filterCallerHeaders(input.payload.headers as Record<string, unknown> | undefined, config.authHeaderName);
  for (const [k, v] of buildAuthHeaders(config, loaded.values.authSecret ?? '').entries()) headers.set(k, v);

  let body: string | undefined;
  if (method !== 'GET' && input.payload.body !== undefined) {
    body = typeof input.payload.body === 'string' ? input.payload.body : JSON.stringify(input.payload.body);
    if (body.length > MAX_PROXY_REQUEST_BYTES) return { ok: false, httpStatus: 413, error: 'Request body is too large.' };
    if (typeof input.payload.body !== 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  const safeFetch =
    deps.safeFetch ?? createSafeFetch({ timeoutMs: config.timeoutMs, maxBytes: config.maxResponseKb * 1024, maxRedirects: 3 });
  const started = Date.now();
  const target = new URL(url);
  let status: number | null = null;
  let bytes = 0;
  let error: string | null = null;
  try {
    const response = await safeFetch(url, { method, headers, body, signal: AbortSignal.timeout(config.timeoutMs) });
    status = response.status;
    const text = await response.text();
    bytes = text.length;
    const contentType = response.headers.get('content-type');
    let parsed: unknown = text;
    if (contentType?.includes('json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { ok: true, status, body: parsed, contentType };
  } catch (err) {
    error = err instanceof SsrfError ? err.message : 'Upstream request failed.';
    return { ok: false, httpStatus: 502, error };
  } finally {
    await prisma.integrationApiLog
      .create({
        data: {
          projectId: row.projectId,
          connectionId: row.id,
          method,
          host: target.hostname,
          path: target.pathname.slice(0, 300),
          status,
          durationMs: Date.now() - started,
          responseBytes: bytes,
          error,
        },
      })
      .catch(() => undefined);
    await recordUsage(row.id).catch(() => undefined);
  }
}
