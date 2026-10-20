import { describe, expect, it } from 'vitest';

import { summarizeReviews } from './stats';

describe('summarizeReviews', () => {
  it('counts sentiment, topics and average', () => {
    const s = summarizeReviews([
      { rating: 5, sentiment: 'positive', topic: 'service' },
      { rating: 2, sentiment: 'negative', topic: 'delivery' },
      { rating: 1, sentiment: 'negative', topic: 'delivery' },
      { rating: 4, sentiment: null, topic: null },
    ]);
    expect(s.averageRating).toBe(3);
    expect(s.sentiment).toEqual({ positive: 1, neutral: 0, negative: 2, unknown: 1 });
    expect(s.topics[0]).toEqual({ topic: 'delivery', count: 2 });
  });

  it('handles empty input', () => {
    expect(summarizeReviews([]).averageRating).toBe(0);
  });
});
