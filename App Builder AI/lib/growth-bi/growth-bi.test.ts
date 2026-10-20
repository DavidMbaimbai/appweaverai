import { describe, expect, it } from 'vitest';

import {
  buildTouch,
  buildUtmUrl,
  classifyChannel,
  mayTrack,
  mergeTouch,
  readGrowthCookie,
  signCookie,
  verifyCookie,
} from './attribution';
import { csvCell } from './csv';
import { assembleProject, leadChannel } from './project';
import { assertNoPii, buildRecommendationCall, dataSufficiency, parseRecommendations, type CatalogMetric } from './recommend';
import { platformRollupRows } from './rollup';
import { acquisitionCost, buildCohorts, buildFunnel, dataHealth, detectAnomaly, forecastTrend, type Journey } from './stats';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const touch = (qs: string, referrer: string | null = null, at = '2026-01-01T00:00:00Z') =>
  buildTouch({ search: new URLSearchParams(qs), referrer, path: '/pricing?x=1', now: new Date(at) });
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe('attribution touches', () => {
  it('keeps the first touch and moves last touch only on informative visits', () => {
    const a = mergeTouch(null, touch('utm_source=LinkedIn&utm_medium=social&utm_campaign=Launch'), () => 'vid1');
    expect(a.first.channel).toBe('linkedin/social');
    const b = mergeTouch(a, touch('utm_source=google&utm_medium=cpc', null, '2026-01-02T00:00:00Z'));
    expect(b.first.channel).toBe('linkedin/social');
    expect(b.last.channel).toBe('google/cpc');
    const c = mergeTouch(b, touch('', null, '2026-01-03T00:00:00Z'));
    expect(c.last.channel).toBe('google/cpc');
    expect(c.v).toBe('vid1');
  });

  it('classifies referrers and drops self-referrals and paths', () => {
    expect(touch('', 'https://www.google.com/search?q=secret').channel).toBe('organic-search');
    expect(touch('', 'https://news.ycombinator.com/item?id=1').referrerHost).toBe('news.ycombinator.com');
    expect(classifyChannel({ referrerHost: 'blog.example.org' })).toBe('referral/blog.example.org');
    expect(buildTouch({ search: new URLSearchParams(), referrer: 'https://appweaverai.com/x', path: '/', ownHosts: ['appweaverai.com'] }).channel).toBe('direct');
    expect(touch('').landingPath).toBe('/pricing');
  });

  it('rejects unsafe utm values', () => {
    expect(touch('utm_source=<script>').source).toBeUndefined();
  });
});

describe('cookie signing and consent', () => {
  const cookie = mergeTouch(null, touch('utm_source=x'), () => 'v');
  it('verifies and rejects tampering', () => {
    const signed = signCookie(cookie, 's3cret');
    expect(verifyCookie(signed, 's3cret')?.v).toBe('v');
    expect(verifyCookie(signed, 'other')).toBeNull();
    const [body, sig] = signed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...cookie, first: { ...cookie.first, channel: 'evil/x' } })).toString('base64url');
    expect(verifyCookie(`${forged}.${sig}`, 's3cret')).toBeNull();
    expect(body).toBeTruthy();
    expect(readGrowthCookie(`a=b; aw_gv=${encodeURIComponent(signed)}`, 's3cret')?.v).toBe('v');
  });

  it('only tracks with explicit consent and no DNT/GPC', () => {
    expect(mayTrack(headers({ cookie: 'aw_cookie_consent=all' }))).toBe(true);
    expect(mayTrack(headers({ cookie: 'aw_cookie_consent=essential' }))).toBe(false);
    expect(mayTrack(headers({}))).toBe(false);
    expect(mayTrack(headers({ cookie: 'aw_cookie_consent=all', dnt: '1' }))).toBe(false);
    expect(mayTrack(headers({ cookie: 'aw_cookie_consent=all', 'sec-gpc': '1' }))).toBe(false);
  });
});

describe('utm links', () => {
  it('builds tagged urls and rejects bad input', () => {
    const r = buildUtmUrl({ baseUrl: 'https://appweaverai.com/', source: 'linkedin', medium: 'social', campaign: 'launch' });
    expect(r.ok && r.url).toContain('utm_source=linkedin');
    expect(buildUtmUrl({ baseUrl: 'javascript:alert(1)', source: 'a', medium: 'b', campaign: 'c' }).ok).toBe(false);
  });
});

const journey = (id: string, over: Partial<Journey> = {}): Journey => ({
  userId: id,
  signedUpAt: d('2026-01-05'),
  firstChannel: 'a/paid',
  lastChannel: 'a/paid',
  firstCampaign: 'c1',
  lastCampaign: 'c1',
  tracked: true,
  activatedAt: null,
  paidAt: null,
  churnedAt: null,
  revenueCents: null,
  activeDays: [],
  ...over,
});

describe('funnel math', () => {
  const js = [
    journey('1', { activatedAt: d('2026-01-06'), paidAt: d('2026-01-10'), revenueCents: 2000 }),
    journey('2', { activatedAt: d('2026-01-06') }),
    journey('3', { firstChannel: 'b/social', lastChannel: 'a/paid' }),
    journey('4', { tracked: false }),
  ];
  it('computes stage rates per channel with the chosen model', () => {
    const f = buildFunnel(js, { 'a/paid': 20, 'b/social': 10 }, 'first');
    const a = f.byChannel.find((r) => r.key === 'a/paid')!;
    expect(a).toMatchObject({ signups: 2, activated: 2, paid: 1, visitors: 20 });
    expect(a.visitorToSignup).toBeCloseTo(0.1);
    expect(a.signupToActivated).toBe(1);
    expect(a.activatedToPaid).toBe(0.5);
    expect(f.all.signups).toBe(4);
    const last = buildFunnel(js, {}, 'last');
    expect(last.byChannel.find((r) => r.key === 'a/paid')!.signups).toBe(3);
  });
  it('never computes a visitor rate for untracked signups', () => {
    const u = buildFunnel(js, { 'a/paid': 20 }).byChannel.find((r) => r.key === 'untracked')!;
    expect(u.visitors).toBeNull();
    expect(u.visitorToSignup).toBeNull();
  });
});

describe('cohort retention and churn', () => {
  it('measures retention relative to each signup and leaves unfinished periods blank', () => {
    const now = d('2026-02-20');
    const js = [
      journey('1', { signedUpAt: d('2026-01-05'), activeDays: ['2026-01-06', '2026-01-13'], paidAt: d('2026-01-07'), churnedAt: d('2026-02-01') }),
      journey('2', { signedUpAt: d('2026-01-05'), activeDays: ['2026-01-06'] }),
    ];
    const [c] = buildCohorts(js, { granularity: 'week', periods: 4, now });
    expect(c.size).toBe(2);
    expect(c.retention[0]).toMatchObject({ retained: 2, eligible: 2, rate: 1 });
    expect(c.retention[1]).toMatchObject({ retained: 1, eligible: 2, rate: 0.5 });
    expect(c.paid).toBe(1);
    expect(c.churned).toBe(1);
    expect(c.churnRate).toBe(1);
    const young = buildCohorts([journey('3', { signedUpAt: d('2026-02-18') })], { granularity: 'week', periods: 3, now })[0];
    expect(young.retention[1]?.rate ?? null).toBeNull();
  });
});

describe('CAC / ROAS', () => {
  it('reports insufficient data instead of fabricating', () => {
    expect(acquisitionCost({ spendCents: 0, signups: 50, activated: 20, paid: 10, revenueCents: 5000 }).cac.status).toBe('insufficient');
    expect(acquisitionCost({ spendCents: 10000, signups: 3, activated: 2, paid: 2, revenueCents: 4000 }).cac.status).toBe('insufficient');
    const unknownRevenue = acquisitionCost({ spendCents: 10000, signups: 30, activated: 10, paid: 5, revenueCents: null });
    expect(unknownRevenue.roas.status).toBe('insufficient');
    expect(unknownRevenue.cac).toEqual({ status: 'ok', value: 2000 });
    const ok = acquisitionCost({ spendCents: 10000, signups: 30, activated: 10, paid: 5, revenueCents: 30000 });
    expect(ok.roas).toEqual({ status: 'ok', value: 3 });
    expect(ok.costPerActivation).toEqual({ status: 'ok', value: 1000 });
  });
});

describe('anomalies, forecast and data health', () => {
  const steady = Array.from({ length: 20 }, (_, i) => 50 + (i % 3));
  it('flags a sudden drop and a spike using robust statistics', () => {
    expect(detectAnomaly([...steady, 5])).toMatchObject({ status: 'anomaly', kind: 'DROP' });
    expect(detectAnomaly([...steady, 400])).toMatchObject({ status: 'anomaly', kind: 'SPIKE' });
    expect(detectAnomaly([...steady, 51]).status).toBe('normal');
  });
  it('is not fooled by an earlier outlier and ignores short or tiny series', () => {
    expect(detectAnomaly([...steady.slice(0, 10), 900, ...steady.slice(10), 51]).status).toBe('normal');
    expect(detectAnomaly([1, 2, 3]).status).toBe('insufficient');
    expect(detectAnomaly([...Array(20).fill(1), 0]).status).toBe('normal');
  });
  it('refuses to forecast thin data and labels projections', () => {
    expect(forecastTrend([1, 2, 3]).status).toBe('insufficient');
    expect(forecastTrend(Array(25).fill(0)).status).toBe('insufficient');
    const f = forecastTrend(Array.from({ length: 28 }, (_, i) => 10 + i));
    expect(f.status === 'ok' && f.label).toMatch(/trailing trend/i);
  });
  it('scores data health and says so when there is no data', () => {
    expect(dataHealth({ visits: 0, visitsTagged: 0, signups: 0, signupsTracked: 0, campaigns: 0, campaignsUnrecorded: 0 }).score).toBeNull();
    expect(dataHealth({ visits: 100, visitsTagged: 90, signups: 10, signupsTracked: 9, campaigns: 2, campaignsUnrecorded: 0 }).score).toBeGreaterThan(80);
  });
});

const catalog: CatalogMetric[] = [
  { id: 'funnel.visitors', label: 'Visitors', value: 400, unit: 'count', period: 'p' },
  { id: 'funnel.signups', label: 'Signups', value: 40, unit: 'count', period: 'p' },
  { id: 'funnel.visitor_to_signup', label: 'Rate', value: 0.1, unit: 'percent', period: 'p' },
];
const rec = (over: Record<string, unknown>) =>
  JSON.stringify({ recommendations: [{ title: 'Test a LinkedIn post', rationale: 'Signups are 40 from 400 visitors.', metricIds: ['funnel.signups', 'funnel.visitors'], action: { type: 'UTM_LINK', brief: 'Tag it' }, ...over }] });

describe('recommendation grounding', () => {
  it('accepts a grounded recommendation and rebuilds evidence from the catalogue', () => {
    const r = parseRecommendations(rec({}), catalog);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].evidence.map((e) => e.id)).toEqual(['funnel.signups', 'funnel.visitors']);
    expect(r.accepted[0].evidence[0].value).toBe(40);
  });
  it('rejects a recommendation with no metric id or an unknown one', () => {
    expect(parseRecommendations(rec({ metricIds: [] }), catalog).rejected[0].reason).toMatch(/no metric id/i);
    expect(parseRecommendations(rec({ metricIds: ['made.up'] }), catalog).rejected[0].reason).toMatch(/unknown/i);
  });
  it('rejects invented numbers, promised outcomes and bad actions', () => {
    expect(parseRecommendations(rec({ rationale: 'Signups are 73.' }), catalog).accepted).toHaveLength(0);
    expect(parseRecommendations(rec({ rationale: 'This will double signups.' }), catalog).accepted).toHaveLength(0);
    expect(parseRecommendations(rec({ action: { type: 'SPEND_MONEY', brief: '' } }), catalog).accepted).toHaveLength(0);
    expect(parseRecommendations('not json', catalog).accepted).toHaveLength(0);
  });
  it('skips below the data thresholds', () => {
    expect(dataSufficiency('PLATFORM', catalog).ok).toBe(true);
    expect(dataSufficiency('PLATFORM', [{ ...catalog[0], value: 10 }, catalog[1]]).ok).toBe(false);
    expect(dataSufficiency('PROJECT', []).ok).toBe(false);
  });
});

describe('PII exclusion', () => {
  it('refuses prompts containing emails and wraps metrics as untrusted data', () => {
    expect(() => assertNoPii('contact ann@example.com')).toThrow();
    const call = buildRecommendationCall('PLATFORM', catalog, 30);
    expect(call.messages[0].content).not.toMatch(/@/);
    expect(call.messages[0].content).toContain('funnel.signups');
    expect(() => buildRecommendationCall('PLATFORM', [{ ...catalog[0], label: 'from ann@example.com' }], 30)).toThrow();
  });
  it('neutralises spreadsheet formulas in exports', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
  });
});

describe('project channel assembly', () => {
  it('attributes leads by their own utm and never guesses untagged ones', () => {
    expect(leadChannel(null)).toBe('untagged');
    expect(leadChannel({ source: 'Facebook', medium: 'paid' })).toBe('facebook/paid');
    const s = assembleProject({
      from: d('2026-01-01'),
      to: new Date('2026-01-04T00:00:00Z'),
      viewGroups: [{ source: 'facebook', medium: 'paid', views: 80, visitors: 60 }, { views: 20, visitors: 15 }],
      dailyViews: [{ day: '2026-01-01', views: 100 }],
      leads: [
        { id: '1', utm: { source: 'facebook', medium: 'paid', campaign: 'x' }, status: 'WON', createdAt: d('2026-01-02') },
        { id: '2', utm: null, status: 'NEW', createdAt: d('2026-01-02') },
      ],
      bookingLeadUtms: [{ source: 'facebook', medium: 'paid' }],
      visitorsTotal: 75,
    });
    expect(s.totals).toMatchObject({ views: 100, leads: 2, won: 1, bookings: 1 });
    expect(s.channels.find((c) => c.channel === 'facebook/paid')).toMatchObject({ views: 80, leads: 1, won: 1, bookings: 1 });
    expect(s.untaggedLeadPct).toBe(0.5);
    expect(s.untaggedViewPct).toBeCloseTo(0.2);
    expect(s.retention.status).toBe('not_available');
    expect(s.trend).toHaveLength(3);
  });
});

describe('rollup rows', () => {
  it('buckets events by their own day and is deterministic', () => {
    const days = ['2026-01-05', '2026-01-06'];
    const input = {
      days,
      journeys: [journey('1', { activatedAt: d('2026-01-06'), paidAt: d('2026-01-06') })],
      visits: [{ day: '2026-01-05', channel: 'a/paid', visits: 4, visitors: 3 }],
      activeUsers: new Map([['2026-01-06', 2]]),
    };
    const rows = platformRollupRows(input);
    const get = (day: string, dimension: string, dimKey: string, metric: string) => rows.find((r) => r.day === day && r.dimension === dimension && r.dimKey === dimKey && r.metric === metric)?.value;
    expect(get('2026-01-05', 'total', '', 'signups')).toBe(1);
    expect(get('2026-01-06', 'total', '', 'activations')).toBe(1);
    expect(get('2026-01-06', 'channel', 'a/paid', 'paid')).toBe(1);
    expect(get('2026-01-05', 'channel', 'a/paid', 'visits')).toBe(4);
    expect(get('2026-01-06', 'total', '', 'active_users')).toBe(2);
    expect(platformRollupRows(input)).toEqual(rows);
  });
});
