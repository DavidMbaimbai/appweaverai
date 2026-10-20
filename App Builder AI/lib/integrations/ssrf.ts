import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';

import { isPrivateIp } from '@/lib/investor-hub/safe-fetch';
import { isSafePublicUrl } from '@/lib/outreach/compliance';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const ALLOWED_PORTS = new Set(['', '443', '8443']);

/** isPrivateIp plus benchmarking/IETF ranges and hex-form IPv4-mapped IPv6 addresses. */
export function isBlockedIp(ip: string): boolean {
  if (isPrivateIp(ip)) return true;
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

/** Static checks on a user-supplied URL. DNS is checked separately, at connect time. */
export function validateOutboundUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  if (typeof raw !== 'string' || raw.length > 2048) return { ok: false, reason: 'Enter a valid https:// URL.' };
  if (!isSafePublicUrl(raw)) return { ok: false, reason: 'Only public https:// hosts are allowed.' };
  const url = new URL(raw);
  if (url.username || url.password) return { ok: false, reason: 'Do not put credentials in the URL.' };
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: 'Only ports 443 and 8443 are allowed.' };
  if (isIP(url.hostname)) return { ok: false, reason: 'IP addresses are not allowed; use a hostname.' };
  return { ok: true, url };
}

type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true });

/**
 * Resolves the host and refuses any private, loopback or link-local answer. The connection uses the very
 * addresses returned here, so a hostname cannot resolve to a different (internal) address between check and use.
 */
export function createGuardedLookup(resolver: Resolver = defaultResolver) {
  return (
    hostname: string,
    options: { all?: boolean } | undefined,
    callback: (err: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void,
  ) => {
    resolver(hostname)
      .then((records) => {
        if (records.length === 0) return callback(new SsrfError('Host did not resolve.'));
        if (records.some((r) => isBlockedIp(r.address))) {
          return callback(new SsrfError('Host resolves to a private address.'));
        }
        if (options?.all) return callback(null, records);
        return callback(null, records[0].address, records[0].family);
      })
      .catch((error: unknown) => callback(error instanceof Error ? error : new Error('DNS lookup failed.')));
  };
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolver?: Resolver;
};

const SAFE_REDIRECT_HEADERS = new Set(['accept', 'content-type', 'user-agent']);

function once(
  url: URL,
  method: string,
  headers: Headers,
  body: Buffer | null,
  opts: Required<Omit<SafeFetchOptions, 'resolver'>> & { resolver?: Resolver },
  signal?: AbortSignal | null,
): Promise<{ status: number; headers: Headers; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const plain: Record<string, string> = {};
    headers.forEach((value, key) => {
      plain[key] = value;
    });
    if (body) plain['content-length'] = String(body.length);

    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers: plain,
        lookup: createGuardedLookup(opts.resolver) as never,
        timeout: opts.timeoutMs,
        signal: signal ?? undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            req.destroy(new SsrfError('Response is larger than the allowed size.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
          resolve({ status: res.statusCode ?? 0, headers: responseHeaders, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * fetch() replacement for user-defined hosts: https only, public addresses only (checked at connect time),
 * manual redirects with a hop limit (each hop re-validated, credentials dropped across origins), size and time caps.
 */
export function createSafeFetch(options: SafeFetchOptions = {}): typeof fetch {
  const opts = {
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 1_000_000,
    maxRedirects: options.maxRedirects ?? 3,
    resolver: options.resolver,
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let current = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let method = (init?.method ?? 'GET').toUpperCase();
    let headers = new Headers(init?.headers);
    let body: Buffer | null =
      init?.body == null ? null : Buffer.from(typeof init.body === 'string' ? init.body : String(init.body));
    if (!headers.has('user-agent')) headers.set('user-agent', 'AppWeaverIntegrations/1.0');

    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      const checked = validateOutboundUrl(current);
      if (!checked.ok) throw new SsrfError(checked.reason);

      const res = await once(checked.url, method, headers, body, opts, init?.signal);
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        const next = new URL(location, checked.url);
        if (next.origin !== checked.url.origin) {
          const stripped = new Headers();
          headers.forEach((value, key) => {
            if (SAFE_REDIRECT_HEADERS.has(key)) stripped.set(key, value);
          });
          headers = stripped;
        }
        if (res.status !== 307 && res.status !== 308) {
          method = 'GET';
          body = null;
          headers.delete('content-type');
        }
        current = next.toString();
        continue;
      }
      const noBody = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(noBody ? null : new Uint8Array(res.body), { status: res.status, headers: res.headers });
    }
    throw new SsrfError('Too many redirects.');
  }) as typeof fetch;
}
