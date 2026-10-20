import { lookup } from 'node:dns/promises';

import { parse } from 'node-html-parser';

import { isPrivateIp } from '@/lib/investor-hub/safe-fetch';
import { prisma } from '@/lib/prisma';

export type SmokeOutcome = 'PASS' | 'SUSPECTED' | 'CONFIRMED_FAILURE';

export type SmokeDetail = {
  name: string;
  ok: boolean;
  /** A definitive HTTP answer (e.g. 404/5xx) rather than a network error or timeout. */
  definitive?: boolean;
  informational?: boolean;
  detail: string;
};

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 500_000;
const MAX_REDIRECTS = 3;
const MAX_LINKS = 5;
const KEEP_CHECKS = 50;

export function appOrigin() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.BETTER_AUTH_URL?.trim() || ''
  ).replace(/\/$/, '');
}

/** The project's own published URL. Returns the allowed hosts alongside so fetches can never leave them. */
export function resolveSmokeTarget(
  deployment: { domain: string; customDomain: string | null },
  origin = appOrigin(),
): { url: string; allowedHosts: string[] } | null {
  try {
    let url: URL;
    if (deployment.customDomain) url = new URL(`https://${deployment.customDomain}`);
    else if (deployment.domain.startsWith('/')) {
      if (!origin) return null;
      url = new URL(deployment.domain, origin);
    } else url = new URL(`https://${deployment.domain}`);
    return { url: url.toString(), allowedHosts: [url.host] };
  } catch {
    return null;
  }
}

export function extractPageSignals(html: string, baseUrl: string) {
  const root = parse(html);
  const title = root.querySelector('title')?.text.trim() || null;
  const base = new URL(baseUrl);
  const links = new Set<string>();
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')?.trim();
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const target = new URL(href, base);
      if (target.host === base.host && /^https?:$/.test(target.protocol)) {
        target.hash = '';
        if (target.toString() !== base.toString()) links.add(target.toString());
      }
    } catch {
      // Ignore unparsable hrefs.
    }
  }
  return { title, links: [...links].slice(0, MAX_LINKS), formCount: root.querySelectorAll('form').length };
}

export function classifySmoke(details: SmokeDetail[]): SmokeOutcome {
  const failures = details.filter((d) => !d.ok && !d.informational);
  if (failures.some((d) => d.definitive)) return 'CONFIRMED_FAILURE';
  return failures.length ? 'SUSPECTED' : 'PASS';
}

/**
 * A fix may only be called verified when a passing check was recorded AFTER the
 * fix was marked deployed, and the most recent check overall is still passing.
 */
export function isFixConfirmed(
  checks: Array<{ id?: string; outcome: string; checkedAt: Date }>,
  since: Date,
): { confirmed: boolean; checkId?: string } {
  const sorted = [...checks].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
  const latest = sorted[0];
  if (!latest || latest.checkedAt <= since) return { confirmed: false };
  return { confirmed: latest.outcome === 'PASS', checkId: latest.id };
}

async function assertPublicHost(url: URL) {
  if (process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname)) return;
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((r) => isPrivateIp(r.address))) {
    throw new Error('Host does not resolve to a public address.');
  }
}

/** SSRF-safe: exact host allow-list, https, public DNS, manual same-host redirects, byte cap. */
export async function guardedFetch(rawUrl: string, allowedHosts: string[]) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = new URL(current);
    const devLocal = process.env.NODE_ENV !== 'production' && url.hostname === 'localhost';
    if (!allowedHosts.includes(url.host)) throw new Error('Host is not the project\'s own domain.');
    if (url.protocol !== 'https:' && !(devLocal && url.protocol === 'http:')) {
      throw new Error('Only https is allowed.');
    }
    if (url.username || url.password) throw new Error('Credentials in URLs are not allowed.');
    await assertPublicHost(url);

    const response = await fetch(url, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'text/html,*/*', 'user-agent': 'AppWeaverSmoke/1.0' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without a destination.');
      current = new URL(location, url).toString();
      continue;
    }
    const type = response.headers.get('content-type') ?? '';
    let body = '';
    if (/text\/html|xhtml/i.test(type) && response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
      }
      await reader.cancel().catch(() => null);
      body = Buffer.concat(chunks).toString('utf8');
    } else {
      await response.body?.cancel().catch(() => null);
    }
    return { status: response.status, contentType: type, body, finalUrl: url.toString() };
  }
  throw new Error('Too many redirects.');
}

const isDefinitiveBad = (status: number) => status === 404 || status === 410 || status >= 500;

export type SmokeRunResult = {
  outcome: SmokeOutcome;
  url: string;
  statusCode: number | null;
  title: string | null;
  details: SmokeDetail[];
};

export async function smokeCheckUrl(
  url: string,
  allowedHosts: string[],
  fetcher: typeof guardedFetch = guardedFetch,
): Promise<SmokeRunResult> {
  const details: SmokeDetail[] = [];
  let page: Awaited<ReturnType<typeof guardedFetch>> | null = null;
  let firstError = '';

  // One retry so a single transient blip is never reported as a confirmed failure.
  const attempts: Array<{ status: number | null; error?: string }> = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await fetcher(url, allowedHosts);
      attempts.push({ status: result.status });
      page = result;
      if (result.status < 400) break;
    } catch (error) {
      firstError = error instanceof Error ? error.message : 'request failed';
      attempts.push({ status: null, error: firstError });
      page = null;
    }
  }

  const bothBad = attempts.length === 2 && attempts.every((a) => a.status !== null && isDefinitiveBad(a.status));
  if (!page || page.status >= 400) {
    details.push({
      name: 'http_status',
      ok: false,
      definitive: bothBad,
      detail: page ? `Published page returned HTTP ${page.status}` : `Request failed: ${firstError}`,
    });
    return { outcome: classifySmoke(details), url, statusCode: page?.status ?? null, title: null, details };
  }

  details.push({ name: 'http_status', ok: true, detail: `HTTP ${page.status}` });
  const isHtml = /text\/html|xhtml/i.test(page.contentType);
  details.push({ name: 'content_type', ok: isHtml, definitive: !isHtml, detail: isHtml ? 'HTML document' : `Unexpected content type "${page.contentType}"` });
  if (!isHtml) return { outcome: classifySmoke(details), url, statusCode: page.status, title: null, details };

  const signals = extractPageSignals(page.body, page.finalUrl);
  details.push({ name: 'title', ok: Boolean(signals.title), detail: signals.title ? `Title: ${signals.title.slice(0, 120)}` : 'Page has no <title>' });
  details.push({ name: 'forms', ok: true, informational: true, detail: `${signals.formCount} form(s) on the page` });

  const broken: string[] = [];
  let definitiveBroken = false;
  for (const link of signals.links) {
    try {
      const res = await fetcher(link, allowedHosts);
      if (res.status >= 400) {
        broken.push(`${link} → ${res.status}`);
        if (isDefinitiveBad(res.status)) definitiveBroken = true;
      }
    } catch (error) {
      broken.push(`${link} → ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  details.push({
    name: 'links',
    ok: broken.length === 0,
    definitive: definitiveBroken,
    detail: signals.links.length
      ? broken.length
        ? `Broken links: ${broken.join('; ')}`
        : `${signals.links.length} internal link(s) resolved`
      : 'No internal links to check',
  });

  return { outcome: classifySmoke(details), url, statusCode: page.status, title: signals.title, details };
}

/** Runs and stores a smoke check for the project's current PUBLIC live deployment. */
export async function runSmokeCheck(projectId: string) {
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' },
    select: { version: true, domain: true, customDomain: true },
  });
  if (!deployment) return { skipped: 'No public live deployment.' as const };
  const target = resolveSmokeTarget(deployment);
  if (!target) return { skipped: 'No resolvable published URL.' as const };

  const result = await smokeCheckUrl(target.url, target.allowedHosts);
  const stored = await prisma.smokeCheck.create({
    data: {
      projectId,
      url: result.url,
      outcome: result.outcome,
      statusCode: result.statusCode,
      title: result.title,
      version: deployment.version,
      details: JSON.parse(JSON.stringify(result.details)),
    },
  });
  const stale = await prisma.smokeCheck.findMany({
    where: { projectId },
    orderBy: { checkedAt: 'desc' },
    skip: KEEP_CHECKS,
    select: { id: true },
  });
  if (stale.length) await prisma.smokeCheck.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });

  return { check: stored, result };
}

/** Smoke checks for deployed projects, least-recently-checked first. */
export async function runSmokeBatch(limit = 20) {
  const deployments = await prisma.deployment.findMany({
    where: { isCurrent: true, status: 'LIVE', visibility: 'PUBLIC' },
    select: { projectId: true },
  });
  const ids = deployments.map((d) => d.projectId);
  if (!ids.length) return { checked: 0, failed: 0 };

  const latest = await prisma.smokeCheck.groupBy({
    by: ['projectId'],
    where: { projectId: { in: ids } },
    _max: { checkedAt: true },
  });
  const last = new Map(latest.map((l) => [l.projectId, l._max.checkedAt?.getTime() ?? 0]));
  const queue = ids.sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0)).slice(0, limit);

  let failed = 0;
  for (const projectId of queue) {
    try {
      const run = await runSmokeCheck(projectId);
      if ('result' in run && run.result.outcome !== 'PASS') failed += 1;
    } catch (error) {
      console.error('[observatory] smoke failed for project', projectId, error);
    }
  }
  return { checked: queue.length, failed };
}
