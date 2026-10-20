import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/alerts', () => ({ sendAlert: vi.fn(async () => undefined) }));

import { sendAlert } from '@/lib/alerts';

import { captureException, captureMessage } from './index';
import { jobHealth, recordJobResult, resetJobHealthForTests, shouldAlertOnFailureRate } from './jobs';
import { scrubText, scrubValue } from './redact';

afterEach(() => {
  resetJobHealthForTests();
  vi.mocked(sendAlert).mockClear();
  vi.restoreAllMocks();
});

describe('scrubText', () => {
  it('masks connection-string passwords, secret query params, keys and emails', () => {
    const out = scrubText(
      `connect postgres://app:hunter2pass@db.internal:5432/x?sslmode=require       failed for me@x.com https://api.x/y?token=abc123secret&a=1 key ${'sk_' + 'live_'}abcdefghij123456`,
    );
          expect(out).not.toMatch(/hunter2pass|abc123secret|me@x\.com/);
    expect(out).toContain('postgres://[redacted]@db.internal');
  });
});

describe('scrubValue', () => {
  it('drops values under secret-looking keys and scrubs nested strings', () => {
    const out = scrubValue({ authorization: 'Bearer abcdefghijklmnop', nested: { note: 'mail me@x.com' }, n: 3 }) as Record<string, unknown>;
    expect(out.authorization).toBe('[redacted]');
    expect(JSON.stringify(out)).not.toContain('me@x.com');
    expect(out.n).toBe(3);
  });
});

describe('capture without SENTRY_DSN', () => {
  it('logs a redacted line and never throws', async () => {
    delete process.env.SENTRY_DSN;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(captureException(new Error('boom for me@x.com'))).resolves.toBeUndefined();
    await expect(captureMessage('plain')).resolves.toBeUndefined();
    expect(spy.mock.calls.flat().join(' ')).not.toContain('me@x.com');
  });
});

describe('job failure rate', () => {
  it('alerts only once enough recent runs failed', async () => {
    const now = Date.now();
    await recordJobResult('j', true, now);
    await recordJobResult('j', false, now);
    expect(sendAlert).not.toHaveBeenCalled();
    await recordJobResult('j', false, now);
    expect(jobHealth('j', now)).toEqual({ total: 3, failures: 2, rate: 2 / 3 });
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('ignores runs outside the window and low failure rates', () => {
    expect(shouldAlertOnFailureRate({ total: 10, failures: 2, rate: 0.2 })).toBe(false);
    expect(shouldAlertOnFailureRate({ total: 2, failures: 2, rate: 1 })).toBe(false);
  });
});
