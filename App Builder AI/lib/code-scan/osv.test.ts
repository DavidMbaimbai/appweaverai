import { describe, expect, it, vi } from 'vitest';

import { checkDependencies, createOsvCache, cvss3BaseScore, resolveVersion } from './osv';
import { checkCodeScan } from './readiness';
import { decideScanGate, formatScanGateError } from './scan';
import { validateAckReason, type StoredFinding, type StoredScan } from './service';

const pkg = JSON.stringify({ dependencies: { lodash: '4.17.15' }, devDependencies: { vitest: '1.0.0' } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function osvFetch(vulnsByName: Record<string, string[]>, detail: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith('/querybatch')) {
      const { queries } = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string } }> };
      return json({ results: queries.map((q) => ({ vulns: (vulnsByName[q.package.name] ?? []).map((id) => ({ id })) })) });
    }
    const id = decodeURIComponent(target.split('/').pop()!);
    return json(detail[id] ?? { id });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('OSV client', () => {
  it('maps advisories to dependency findings with severity, fixed version and dev cap', async () => {
    const fetchImpl = osvFetch(
      { lodash: ['GHSA-aaaa'], vitest: ['GHSA-bbbb'] },
      {
        'GHSA-aaaa': {
          id: 'GHSA-aaaa',
          summary: 'Prototype pollution',
          aliases: ['CVE-2020-8203'],
          database_specific: { severity: 'CRITICAL' },
          affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }],
        },
        'GHSA-bbbb': { id: 'GHSA-bbbb', database_specific: { severity: 'HIGH' } },
      },
    );
    const result = await checkDependencies(pkg, null, { fetchImpl, cache: createOsvCache() });
    expect(result.status).toBe('OK');
    const lodash = result.findings.find((f) => f.title.startsWith('lodash'))!;
    expect(lodash).toMatchObject({ severity: 'CRITICAL', category: 'DEPENDENCY', file: 'package.json' });
    expect(lodash.message).toContain('4.17.21');
    expect(result.findings.find((f) => f.title.startsWith('vitest'))?.severity).toBe('MEDIUM');
  });

  it('reports a genuinely clean result only when OSV answered', async () => {
    const result = await checkDependencies(pkg, null, { fetchImpl: osvFetch({}, {}), cache: createOsvCache() });
    expect(result).toMatchObject({ status: 'OK', findings: [] });
  });

  it.each([
    ['network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['HTTP 500', () => Promise.resolve(new Response('boom', { status: 500 }))],
    ['malformed body', () => Promise.resolve(json({ nope: true }))],
  ])('returns UNAVAILABLE (never clean) on %s', async (_name, impl) => {
    const result = await checkDependencies(pkg, null, { fetchImpl: vi.fn(impl) as unknown as typeof fetch, cache: createOsvCache() });
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.findings).toEqual([]);
    expect(result.detail).toMatch(/NOT checked/);
  });

  it('returns UNAVAILABLE on timeout', async () => {
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
    ) as unknown as typeof fetch;
    const result = await checkDependencies(pkg, null, { fetchImpl, timeoutMs: 20, cache: createOsvCache() });
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.detail).toMatch(/did not answer/);
  });

  it('serves repeat lookups from the cache', async () => {
    const fetchImpl = osvFetch({ lodash: ['GHSA-aaaa'] }, { 'GHSA-aaaa': { id: 'GHSA-aaaa', database_specific: { severity: 'HIGH' } } });
    const cache = createOsvCache();
    await checkDependencies(pkg, null, { fetchImpl, cache });
    const calls = fetchImpl.mock.calls.length;
    const again = await checkDependencies(pkg, null, { fetchImpl, cache });
    expect(fetchImpl.mock.calls.length).toBe(calls);
    expect(again.findings).toHaveLength(1);
  });

  it('skips honestly when there is no manifest or nothing pinned', async () => {
    expect((await checkDependencies(null, null)).status).toBe('SKIPPED');
    expect((await checkDependencies('{"dependencies":{"a":"latest"}}', null)).status).toBe('SKIPPED');
  });

  it('resolves versions and scores CVSS vectors', () => {
    expect(resolveVersion('^4.17.15')).toBe('4.17.15');
    expect(resolveVersion('latest')).toBeNull();
    expect(resolveVersion('github:foo/bar')).toBeNull();
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(cvss3BaseScore('not a vector')).toBeNull();
  });
});

const finding = (over: Partial<StoredFinding>): StoredFinding => ({
  id: 'f1',
  rule: 'secret/stripe-live-key',
  category: 'SECRET',
  severity: 'CRITICAL',
  file: 'lib/a.ts',
  line: 3,
  title: 'Stripe live secret key',
  message: 'm',
  snippet: null,
  status: 'OPEN',
  ackReason: null,
  ackAt: null,
  firstSeenAt: null,
  fixProposal: null,
  ...over,
});

const scanWith = (findings: StoredFinding[], over: Partial<StoredScan> = {}): StoredScan => ({
  id: 'r1',
  trigger: 'MANUAL',
  source: 'WORKING',
  createdAt: new Date().toISOString(),
  filesScanned: 5,
  counts: { critical: 0, high: 0, medium: 0, low: 0 },
  depStatus: 'OK',
  depDetail: null,
  findings,
  ...over,
});

describe('publish gate decision', () => {
  it('blocks open HIGH/CRITICAL, ignores acknowledged, fixed, medium and low', () => {
    const decision = decideScanGate([
      finding({ id: 'a' }),
      finding({ id: 'b', severity: 'HIGH' }),
      finding({ id: 'c', status: 'ACKNOWLEDGED' }),
      finding({ id: 'd', status: 'FIXED' }),
      finding({ id: 'e', severity: 'MEDIUM' }),
    ]);
    expect(decision.blocked).toBe(true);
    expect(decision.blocking.map((f) => f.id)).toEqual(['a', 'b']);
    expect(formatScanGateError(decision.blocking)).toContain('2 high/critical');
    expect(decideScanGate([finding({ status: 'ACKNOWLEDGED' }), finding({ severity: 'LOW' })]).blocked).toBe(false);
  });

  it('requires a meaningful acknowledgement reason', () => {
    expect(validateAckReason('   ')).not.toBeNull();
    expect(validateAckReason('too short')).not.toBeNull();
    expect(validateAckReason('x'.repeat(501))).not.toBeNull();
    expect(validateAckReason('Test key used only in a sandbox demo')).toBeNull();
  });
});

describe('launch readiness check', () => {
  it('is NOT_VERIFIED without a scan, FAIL on open blockers, PASS when clean', () => {
    expect(checkCodeScan(null).status).toBe('NOT_VERIFIED');
    expect(checkCodeScan(scanWith([finding({})])).status).toBe('FAIL');
    expect(checkCodeScan(scanWith([])).status).toBe('PASS');
  });

  it('never reads as PASS when dependencies were unavailable or findings were only acknowledged', () => {
    const unavailable = checkCodeScan(scanWith([], { depStatus: 'UNAVAILABLE', depDetail: 'down' }));
    expect(unavailable.status).toBe('WARN');
    expect(unavailable.evidence).toMatch(/NOT be checked|could NOT/i);
    expect(checkCodeScan(scanWith([finding({ status: 'ACKNOWLEDGED' })])).status).toBe('WARN');
  });
});
