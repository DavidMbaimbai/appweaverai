import { describe, expect, it } from 'vitest';

import { parseInvestorCsv, toCsv } from './csv';
import { parseHubInvestors } from './extract';
import { advanceStage, classifyReplyHeuristic, normalizeDomain, replyEffect } from './logic';
import { followUpBlockReason, parseVariants, sendBlockReason } from './outreach';
import { isPrivateIp, robotsAllows } from './safe-fetch';
import { scoreInvestor } from './score';
import { everReached } from './service';

describe('scoreInvestor', () => {
  const profile = { sector: 'fintech', stage: 'seed', amountSought: 500_000, geography: 'Europe', description: 'payments software for banks' };

  it('scores a strong match with reasons', () => {
    const r = scoreInvestor(profile, {
      sectors: ['Fintech'], stages: ['Seed'], ticketMin: 250_000, ticketMax: 1_000_000,
      geographies: ['Europe'], portfolio: ['Payments Co', 'Payments Hub'],
    });
    expect(r.score).toBe(100);
    expect(r.missing).toEqual([]);
    expect(r.reasons.length).toBe(5);
  });

  it('reports missing data instead of guessing, and renormalises', () => {
    const r = scoreInvestor(profile, { sectors: ['fintech'] });
    expect(r.score).toBe(100);
    expect(r.missing.length).toBe(4);
  });

  it('returns null with no evaluable factors', () => {
    expect(scoreInvestor({}, {}).score).toBeNull();
  });

  it('penalises mismatches', () => {
    const r = scoreInvestor(profile, { sectors: ['biotech'], stages: ['series b'], ticketMin: 5_000_000, geographies: ['Asia'] });
    expect(r.score).toBe(0);
  });
});

describe('logic', () => {
  it('normalises domains', () => {
    expect(normalizeDomain('https://www.Example.com/path')).toBe('example.com');
    expect(normalizeDomain('example.com')).toBe('example.com');
    expect(normalizeDomain('nonsense')).toBeNull();
  });

  it('classifies replies and lets unsubscribe win', () => {
    expect(classifyReplyHeuristic('Please send the deck, and unsubscribe me')).toBe('unsubscribe');
    expect(classifyReplyHeuristic('Could you send over your pitch deck?')).toBe('deck_requested');
    expect(classifyReplyHeuristic("Let's schedule a call next week")).toBe('meeting_requested');
    expect(classifyReplyHeuristic('We will pass, not a fit')).toBe('not_interested');
    expect(classifyReplyHeuristic('hello')).toBeNull();
  });

  it('applies reply effects', () => {
    expect(replyEffect('unsubscribe')).toEqual({ stage: 'DECLINED', stopSequence: true, optOut: true });
    expect(replyEffect('interested').stopSequence).toBe(true);
  });

  it('only advances stages forward', () => {
    expect(advanceStage('CONTACTED', 'RESEARCHED')).toBe('CONTACTED');
    expect(advanceStage('CONTACTED', 'REPLIED')).toBe('REPLIED');
    expect(advanceStage('FUNDING_SECURED', 'DECLINED')).toBe('FUNDING_SECURED');
  });
});

describe('csv', () => {
  it('round trips and neutralises formulas', () => {
    expect(toCsv(['a'], [['=SUM(1)'], ['x,y']])).toBe("a\r\n'=SUM(1)\r\n\"x,y\"");
  });

  it('parses investor rows', () => {
    const rows = parseInvestorCsv('Name,Email,Type,Tags\nAnn,ann@x.com,angel,a;b\n,skip@x.com,,');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Ann', email: 'ann@x.com', type: 'ANGEL', tags: ['a', 'b'] });
  });
});

describe('safe fetch helpers', () => {
  it('blocks private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.169.254', '172.20.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('honours robots.txt', () => {
    const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/open\n';
    expect(robotsAllows(robots, '/private/x')).toBe(false);
    expect(robotsAllows(robots, '/private/open/y')).toBe(true);
    expect(robotsAllows(robots, '/team')).toBe(true);
    expect(robotsAllows('User-agent: AppWeaverBot\nDisallow: /', '/team')).toBe(false);
    expect(robotsAllows('User-agent: Googlebot\nDisallow: /', '/team')).toBe(true);
  });
});

describe('extraction', () => {
  it('drops unpublished emails and portfolio names', () => {
    const page = 'Acme Ventures invests in seed. Contact hi@acme.vc. Portfolio: Stripe';
    const out = parseHubInvestors(
      JSON.stringify([{ name: 'Acme Ventures', type: 'vc', email: 'made@up.com', portfolio: ['Stripe', 'Fake Inc'], instruments: ['equity', 'crypto'], ticketMin: 9, ticketMax: 3 }]),
      page,
    );
    expect(out[0].email).toBeNull();
    expect(out[0].portfolio).toEqual(['Stripe']);
    expect(out[0].instruments).toEqual(['equity']);
    expect(out[0].ticketMin).toBe(3);
    expect(parseHubInvestors('not json', page)).toEqual([]);
  });
});

describe('outreach gates', () => {
  const ok = { status: 'APPROVED', optedOut: false, suppressed: false, sentToday: 0, limit: 5 };
  it('requires approval, honours opt-out and daily limit', () => {
    expect(sendBlockReason(ok)).toBeNull();
    expect(sendBlockReason({ ...ok, status: 'DRAFT' })).toMatch(/approved/);
    expect(sendBlockReason({ ...ok, optedOut: true })).toMatch(/opted out/);
    expect(sendBlockReason({ ...ok, suppressed: true })).toMatch(/suppression/);
    expect(sendBlockReason({ ...ok, sentToday: 5 })).toMatch(/limit/);
  });

  it('stops follow-ups after reply, opt-out or the cap', () => {
    const base = { sequenceActive: true, optedOut: false, firstSent: true, followUpsSent: 0 };
    expect(followUpBlockReason(base)).toBeNull();
    expect(followUpBlockReason({ ...base, sequenceActive: false })).toMatch(/stopped/);
    expect(followUpBlockReason({ ...base, optedOut: true })).toMatch(/opted out/);
    expect(followUpBlockReason({ ...base, followUpsSent: 2 })).toMatch(/limited/);
    expect(followUpBlockReason({ ...base, firstSent: false })).toMatch(/first email/);
  });

  it('parses variants', () => {
    expect(parseVariants('{"variants":[{"subject":"Hi","body":"Hello"},{"body":""}]}')).toEqual([{ subject: 'Hi', body: 'Hello' }]);
    expect(parseVariants('nope')).toEqual([]);
  });
});

describe('analytics', () => {
  it('counts investors that ever reached a stage, excluding declines', () => {
    const events = [
      { investorId: 'a', type: 'stage:MEETING_SCHEDULED' },
      { investorId: 'b', type: 'stage:DECLINED' },
      { investorId: 'a', type: 'note' },
    ];
    const current = [
      { id: 'a', pipelineStage: 'DECLINED' as const },
      { id: 'b', pipelineStage: 'DECLINED' as const },
      { id: 'c', pipelineStage: 'QUALIFIED' as const },
    ];
    expect(everReached(events, current, 'MEETING_SCHEDULED')).toBe(1);
    expect(everReached(events, current, 'QUALIFIED')).toBe(2);
  });
});
