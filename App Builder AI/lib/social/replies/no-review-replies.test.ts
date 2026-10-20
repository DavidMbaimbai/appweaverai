import { describe, expect, it } from 'vitest';

import { parseSocialReply } from '@/lib/social/replies/generate';
import { REVIEW_NOTE, looksLikeReview, shouldAutoReply } from '@/lib/support-inbox/filters';

describe('reviews are never answered by AI', () => {
  it('detects reviews', () => {
    expect(looksLikeReview('Left you a 5 star review on Trustpilot')).toBe(true);
    expect(looksLikeReview('How do I reset my password?')).toBe(false);
  });

  it('skips email reviews', () => {
    const result = shouldAutoReply({
      fromAddress: 'a@b.com',
      ownAddresses: ['support@x.com'],
      headers: { get: () => null },
      subject: 'My review',
      body: 'I would rate this 4 stars',
    });
    expect(result).toMatchObject({ reply: false, reason: REVIEW_NOTE });
  });

  it('drops any draft for a review, even if the model says USER', () => {
    const parsed = parseSocialReply(
      JSON.stringify({ audience: 'USER', reply: 'Thanks!', confidence: 0.99 }),
      'Great app, 5 stars, my honest review',
    );
    expect(parsed).toMatchObject({ review: true, reply: '', audience: 'IGNORE' });
  });

  it('honours a REVIEW classification from the model', () => {
    const parsed = parseSocialReply(
      JSON.stringify({ audience: 'REVIEW', reply: 'Thanks!', confidence: 0.9 }),
      'it was fine',
    );
    expect(parsed.review).toBe(true);
    expect(parsed.reply).toBe('');
  });
});
