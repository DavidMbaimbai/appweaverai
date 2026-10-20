import { describe, expect, it } from 'vitest';

import { canTransition, isMeasurementDue, parseProposals, resultNote, toWindow } from './experiments';
import { breakdownLeads, buildMetrics, gate } from './metrics';

describe('metrics aggregation', () => {
  it('distinguishes not-available from a measured zero', () => {
    const metrics = buildMetrics({ pageViews: 0, leads: gate(false, 0), averageRating: null });
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
    expect(byKey.pageViews).toMatchObject({ value: 0, status: 'measured' });
    expect(byKey.leads).toMatchObject({ value: null, status: 'not_available' });
    expect(byKey.averageRating.value).toBeNull();
    expect(byKey.videoReleases.status).toBe('not_available');
  });

  it('breaks leads down by source and utm without inventing untagged data', () => {
    const b = breakdownLeads([
      { source: 'widget', utm: { source: 'fb', medium: 'cpc' } },
      { source: 'widget', utm: null },
      { source: 'form:contact', utm: { source: 'fb', medium: 'cpc' } },
    ]);
    expect(b.bySource[0]).toEqual({ label: 'widget', count: 2 });
    expect(b.byUtm).toEqual([{ label: 'fb / cpc', count: 2 }]);
    expect(b.untracked).toBe(1);
  });
});

describe('experiment lifecycle', () => {
  it('only allows the approved path', () => {
    expect(canTransition('PROPOSED', 'APPROVED')).toBe(true);
    expect(canTransition('PROPOSED', 'RUNNING')).toBe(false);
    expect(canTransition('APPROVED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'MEASURED')).toBe(true);
    expect(canTransition('RUNNING', 'REJECTED')).toBe(false);
    expect(canTransition('MEASURED', 'RUNNING')).toBe(false);
    expect(canTransition('REJECTED', 'APPROVED')).toBe(false);
  });

  it('measures only after the window elapsed', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(isMeasurementDue(start, 14, new Date('2026-01-14T00:00:00Z'))).toBe(false);
    expect(isMeasurementDue(start, 14, new Date('2026-01-15T00:00:00Z'))).toBe(true);
  });

  it('writes a correlation-only note and handles missing data', () => {
    const metrics = buildMetrics({ leads: 4 });
    const before = toWindow('leads', metrics, 14, new Date(), new Date());
    const after = { ...before, value: 7 };
    expect(resultNote(before, after)).toMatch(/rose by 3.*correlation only/);
    expect(resultNote({ ...before, value: null }, after)).toMatch(/Nothing can be concluded/);
  });
});

describe('agent output validation', () => {
  const metrics = buildMetrics({ pageViews: 200, leads: 4 });
  const make = (over: Record<string, unknown> = {}, text = 'Only 4 leads came from 200 page views') =>
    JSON.stringify({
      experiments: [
        {
          hypothesis: text,
          bottleneck: 'Visitors do not reach the form',
          action: { type: 'LANDING_PAGE_PROMPT', title: 'Move form up', brief: 'Move the lead form above the fold', metricKey: 'leads', priority: 1, citedMetrics: [{ key: 'leads', value: 4 }], ...over },
        },
      ],
    });

  it('keeps well-supported proposals', () => {
    expect(parseProposals(make(), metrics)).toHaveLength(1);
  });

  it('drops invented numbers, wrong citations, guarantees and unknown actions', () => {
    expect(parseProposals(make({}, 'Only 4 leads from 900 page views'), metrics)).toHaveLength(0);
    expect(parseProposals(make({ citedMetrics: [{ key: 'leads', value: 5 }] }), metrics)).toHaveLength(0);
    expect(parseProposals(make({}, 'This will double leads'), metrics)).toHaveLength(0);
    expect(parseProposals(make({ type: 'BUY_ADS' }), metrics)).toHaveLength(0);
    expect(parseProposals(make({ citedMetrics: [{ key: 'reviews', value: 0 }] }), metrics)).toHaveLength(0);
  });
});
