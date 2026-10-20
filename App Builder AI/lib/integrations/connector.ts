import { validateOutboundUrl } from './ssrf';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESPONSE_KB = 512;
export const MAX_RESPONSE_KB = 2_048;

/** Request headers a generated app may never set through the proxy. */
const FORBIDDEN_REQUEST_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'x-forwarded-for',
  'x-forwarded-host',
]);

export type ConnectorConfig = {
  baseUrl: string;
  authScheme: 'none' | 'bearer' | 'header' | 'basic';
  authHeaderName: string;
  basicUsername: string;
  allowedMethods: HttpMethod[];
  allowedPaths: string[];
  timeoutMs: number;
  maxResponseKb: number;
  testPath: string;
};

function toInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function parseConnectorConfig(values: Record<string, string>): ConnectorConfig {
  const methods = (values.allowedMethods || 'GET')
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter((m): m is HttpMethod => (HTTP_METHODS as readonly string[]).includes(m));
  const paths = (values.allowedPaths || '/')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('/'));
  const scheme = ['none', 'bearer', 'header', 'basic'].includes(values.authScheme) ? values.authScheme : 'none';
  return {
    baseUrl: (values.baseUrl ?? '').replace(/\/+$/, ''),
    authScheme: scheme as ConnectorConfig['authScheme'],
    authHeaderName: values.authHeaderName || 'X-API-Key',
    basicUsername: values.basicUsername ?? '',
    allowedMethods: methods.length ? methods : ['GET'],
    allowedPaths: paths.length ? paths : ['/'],
    timeoutMs: toInt(values.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS),
    maxResponseKb: toInt(values.maxResponseKb, DEFAULT_MAX_RESPONSE_KB, 1, MAX_RESPONSE_KB),
    testPath: values.testPath?.startsWith('/') ? values.testPath : '/',
  };
}

export function buildAuthHeaders(config: ConnectorConfig, secret: string): Headers {
  const headers = new Headers();
  if (!secret || config.authScheme === 'none') return headers;
  if (config.authScheme === 'bearer') headers.set('authorization', `Bearer ${secret}`);
  else if (config.authScheme === 'header') headers.set(config.authHeaderName, secret);
  else headers.set('authorization', `Basic ${Buffer.from(`${config.basicUsername}:${secret}`).toString('base64')}`);
  return headers;
}

export function filterCallerHeaders(input: Record<string, unknown> | undefined, authHeaderName: string): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input ?? {})) {
    const name = key.toLowerCase();
    if (typeof value !== 'string' || !/^[a-z0-9-]+$/.test(name)) continue;
    if (FORBIDDEN_REQUEST_HEADERS.has(name) || name === authHeaderName.toLowerCase()) continue;
    if (value.length > 1_024 || /[\r\n]/.test(value)) continue;
    headers.set(name, value);
  }
  return headers;
}

/** Checks the requested path against the connection's allow-list and builds the final URL. */
export function resolveConnectorUrl(
  config: ConnectorConfig,
  path: string,
  query?: Record<string, string>,
): { ok: true; url: string } | { ok: false; reason: string } {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return { ok: false, reason: 'Path must start with a single "/".' };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return { ok: false, reason: 'Path is not valid.' };
  }
  if (/(^|\/)\.\.(\/|$)/.test(decoded) || /[?#\r\n]/.test(decoded) || /(^|\/)\.\.(\/|$)/.test(path)) {
    return { ok: false, reason: 'Path traversal is not allowed.' };
  }
  const pathOnly = path;
  const allowed = config.allowedPaths.some((prefix) => {
    const clean = prefix.replace(/\/+$/, '');
    return clean === '' || pathOnly === clean || pathOnly.startsWith(`${clean}/`);
  });
  if (!allowed) {
    return { ok: false, reason: 'Path is not in the connection’s allowed paths.' };
  }
  const base = validateOutboundUrl(config.baseUrl);
  if (!base.ok) return { ok: false, reason: base.reason };
  const url = new URL(`${base.url.origin}${base.url.pathname.replace(/\/+$/, '')}${path}`);
  if (url.origin !== base.url.origin) return { ok: false, reason: 'Path escapes the base URL.' };
  for (const [key, value] of Object.entries(query ?? {})) {
    if (typeof value === 'string') url.searchParams.set(key, value);
  }
  return { ok: true, url: url.toString() };
}
