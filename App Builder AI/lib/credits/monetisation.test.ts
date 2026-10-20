import { describe, expect, it } from 'vitest';

import { buildEstimate, ESTIMATE_DISCLAIMER } from './estimate';
import { periodOf, thresholdsReached } from './limits';
import { quote } from './pricing';
import { classifyDevEntry, classifyMarketingEntry, csvCell, ledgerToCsv } from './unified-ledger';

describe('buildEstimate', () => {
  it('uses the same price as the charge and carries the disclaimer', () => {
    const e = buildEstimate({ operation: 'launch_kit', metered: true, balance: 500 });
    expect(e.credits).toBe(quote('launch_kit').credits);
    expect(e.balanceAfter).toBe(500 - e.credits);
    expect(e.blocked).toBeNull();
    expect(e.disclaimer).toBe(ESTIMATE_DISCLAIMER);
    expect(e.disclaimer).toMatch(/final cost may differ/);
  });

  it('charges nothing for users who are not credit-metered', () => {
    const e = buildEstimate({ operation: 'agent_run', metered: false, balance: 0 });
    expect(e.credits).toBe(0);
    expect(e.blocked).toBeNull();
  });

  it('flags insufficient credits and spending limits', () => {
    const cost = quote('agent_run').credits;
    expect(buildEstimate({ operation: 'agent_run', metered: true, balance: cost - 1 }).blocked?.reason).toBe('INSUFFICIENT_CREDITS');
    const limited = buildEstimate({
      operation: 'agent_run',
      metered: true,
      balance: 10_000,
      limits: [{ scope: 'USER', spent: 100, cap: 100 + cost - 1 }],
    });
    expect(limited.blocked?.reason).toBe('SPEND_LIMIT');
  });

  it('does not treat the plan allowance as a hard block', () => {
    const e = buildEstimate({ operation: 'agent_run', metered: true, balance: 10_000, limits: [{ scope: 'ALLOWANCE', spent: 9_999, cap: 100 }] });
    expect(e.blocked).toBeNull();
  });
});

describe('usage alert thresholds', () => {
  it('reports 80 and 100 as they are crossed', () => {
    expect(thresholdsReached(79, 100)).toEqual([]);
    expect(thresholdsReached(80, 100)).toEqual([80]);
    expect(thresholdsReached(100, 100)).toEqual([80, 100]);
    expect(thresholdsReached(5, 0)).toEqual([]);
  });

  it('uses a UTC calendar-month period key', () => {
    expect(periodOf(new Date('2026-03-31T23:59:59Z')).period).toBe('2026-03');
    expect(periodOf(new Date('2026-04-01T00:00:00Z')).period).toBe('2026-04');
  });
});

describe('unified ledger classification and CSV', () => {
  it('distinguishes purchased, promotional and subscription credits', () => {
    expect(classifyDevEntry({ operation: 'GRANT', delta: 100, reason: 'pro plan credits', source: null })).toBe('SUBSCRIPTION');
    expect(classifyDevEntry({ operation: 'GRANT', delta: 100, reason: 'Welcome bonus', source: null })).toBe('PROMOTIONAL');
    expect(classifyDevEntry({ operation: 'agent_run', delta: -40, reason: 'x', source: null })).toBe('SPEND');
    expect(classifyDevEntry({ operation: 'REFUND', delta: 40, reason: 'x', source: null })).toBe('REFUND');
    expect(classifyMarketingEntry({ kind: 'PURCHASE', source: 'PURCHASED' })).toBe('PURCHASED');
    expect(classifyMarketingEntry({ kind: 'GRANT', source: 'PROMO' })).toBe('PROMOTIONAL');
    expect(classifyMarketingEntry({ kind: 'GRANT', source: 'SUBSCRIPTION' })).toBe('SUBSCRIPTION');
    expect(classifyMarketingEntry({ kind: 'RESERVE', source: null })).toBeNull();
  });

  it('neutralises spreadsheet formulas and quotes special characters', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5 credits')).toBe("'-5 credits");
  });

  it('writes a header and one line per entry', () => {
    const csv = ledgerToCsv([
      { id: '1', wallet: 'MARKETING', createdAt: new Date('2026-01-01T00:00:00Z'), kind: 'PURCHASED', description: 'Pack', delta: 500, balanceAfter: 500 },
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('2026-01-01T00:00:00.000Z,Marketing,Purchased,Pack,500,500');
  });
});
