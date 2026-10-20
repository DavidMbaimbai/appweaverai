import { describe, expect, it } from 'vitest';

import { summarizeChecks } from './health';

describe('summarizeChecks', () => {
  it('computes uptime from real checks', () => {
    expect(summarizeChecks([{ ok: true }, { ok: true }, { ok: false }])).toEqual({
      total: 3,
      passed: 2,
      uptimePercent: 66.7,
    });
  });

  it('reports no uptime when there are no checks', () => {
    expect(summarizeChecks([]).uptimePercent).toBeNull();
  });
});
