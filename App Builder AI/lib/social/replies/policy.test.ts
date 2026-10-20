import { describe, expect, it } from 'vitest';

import { parseSocialReply } from '@/lib/social/replies/generate';
import {
  decideReply,
  fitReply,
  looksLikeInvestor,
  normalizeReplyPlatform,
  shouldReplyToInteraction,
} from '@/lib/social/replies/policy';

const base = { confidence: 0.9, escalate: false, minConfidence: 0.7 };

describe('decideReply', () => {
  it('auto-sends confident replies to users', () => {
    expect(decideReply({ ...base, audience: 'USER' })).toEqual({ action: 'SEND' });
  });

  it('always holds investors, however confident', () => {
    expect(decideReply({ ...base, audience: 'INVESTOR', confidence: 1 }).action).toBe('HOLD');
  });

  it('holds escalated, low-confidence, or approval-required user replies', () => {
    expect(decideReply({ ...base, audience: 'USER', escalate: true }).action).toBe('HOLD');
    expect(decideReply({ ...base, audience: 'USER', confidence: 0.5 }).action).toBe('HOLD');
    expect(decideReply({ ...base, audience: 'USER', requireApproval: true }).action).toBe('HOLD');
  });

  it('skips ignorable messages', () => {
    expect(decideReply({ ...base, audience: 'IGNORE' }).action).toBe('SKIP');
  });
});

describe('parseSocialReply', () => {
  it('never lets an investor-sounding message through as USER', () => {
    const out = parseSocialReply(
      '{"audience":"USER","reply":"Thanks!","escalate":false,"confidence":0.95}',
      'We are a VC fund interested in your seed round',
    );
    expect(out.audience).toBe('INVESTOR');
    expect(out.escalate).toBe(true);
  });

  it('treats a missing confidence as zero and rejects empty replies', () => {
    expect(parseSocialReply('{"audience":"USER","reply":"Hi"}', 'hello').confidence).toBe(0);
    expect(() => parseSocialReply('{"audience":"USER","reply":""}', 'hello')).toThrow();
  });

  it('allows an empty reply for IGNORE', () => {
    expect(parseSocialReply('{"audience":"IGNORE","reply":""}', 'buy followers').audience).toBe(
      'IGNORE',
    );
  });
});

describe('helpers', () => {
  it('detects investor language', () => {
    expect(looksLikeInvestor('Would love to discuss a term sheet')).toBe(true);
    expect(looksLikeInvestor('How do I publish my site?')).toBe(false);
  });

  it('normalizes platforms', () => {
    expect(normalizeReplyPlatform('twitter')).toBe('X');
    expect(normalizeReplyPlatform('Reddit')).toBe('REDDIT');
    expect(normalizeReplyPlatform('mastodon')).toBe('OTHER');
  });

  it('skips own accounts and stop requests', () => {
    const own = ['@AppWeaverAI'];
    expect(shouldReplyToInteraction({ authorHandle: 'appweaverai', ownHandles: own, text: 'hi' }).reply).toBe(false);
    expect(shouldReplyToInteraction({ authorHandle: 'jane', ownHandles: own, text: 'STOP' }).reply).toBe(false);
    expect(shouldReplyToInteraction({ authorHandle: 'jane', ownHandles: own, text: 'hi' }).reply).toBe(true);
  });

  it('fits X replies to 280 characters', () => {
    const out = fitReply('X', 'word '.repeat(100));
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out.endsWith('…')).toBe(true);
  });
});
