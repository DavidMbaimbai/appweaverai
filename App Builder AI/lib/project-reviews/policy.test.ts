import { describe, expect, it } from 'vitest';

import { decideReply, flaggedKeywords } from './policy';

const on = { enabled: true, autoReplyPositive: true };
const good = { rating: 5, body: 'Loved it, great service!', sentiment: 'positive', urgency: 'low' };

describe('decideReply', () => {
  it('auto-sends only a clean positive review when the owner opted in', () => {
    expect(decideReply(good, on).action).toBe('AUTO_SEND');
    expect(decideReply({ ...good, rating: 4 }, on).action).toBe('AUTO_SEND');
  });

  it('holds when auto-reply is off (default) or assistant disabled', () => {
    expect(decideReply(good, { enabled: true, autoReplyPositive: false }).action).toBe('HOLD_FOR_APPROVAL');
    expect(decideReply(good, { enabled: false, autoReplyPositive: true }).action).toBe('HOLD_FOR_APPROVAL');
  });

  it('holds ratings below 4 and unknown classification', () => {
    expect(decideReply({ ...good, rating: 3 }, on).action).toBe('HOLD_FOR_APPROVAL');
    expect(decideReply({ ...good, sentiment: null }, on).action).toBe('HOLD_FOR_APPROVAL');
    expect(decideReply({ ...good, urgency: null }, on).action).toBe('HOLD_FOR_APPROVAL');
  });

  it('holds neutral sentiment even with 5 stars', () => {
    expect(decideReply({ ...good, sentiment: 'neutral' }, on).action).toBe('HOLD_FOR_APPROVAL');
  });

  it.each(['I want a refund', 'my lawyer will call', 'this is a scam', 'I will dispute the charge', 'a threat'])(
    'flags %s even at 5 stars',
    (body) => {
      const d = decideReply({ ...good, body }, on);
      expect(d.action).toBe('HOLD_FOR_APPROVAL');
      expect(d).toMatchObject({ notifyOwner: true });
    },
  );

  it('notifies owner for negative or urgent, not for mere pending 4-star', () => {
    expect(decideReply({ ...good, sentiment: 'negative', rating: 2 }, on)).toMatchObject({ notifyOwner: true });
    expect(decideReply({ ...good, urgency: 'high' }, on)).toMatchObject({ notifyOwner: true });
    expect(decideReply(good, { enabled: true, autoReplyPositive: false })).toMatchObject({ notifyOwner: false });
  });
});

describe('flaggedKeywords', () => {
  it('returns matches', () => {
    expect(flaggedKeywords('Refund me or my attorney')).toEqual(['refund', 'attorney']);
    expect(flaggedKeywords('lovely')).toEqual([]);
  });
});
