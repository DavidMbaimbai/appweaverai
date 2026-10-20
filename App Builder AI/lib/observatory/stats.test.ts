import { describe, expect, it } from 'vitest';

import { averageResponseHours, sentimentTrend, topRecurringIssues, type ReviewLite } from './stats';

const now = new Date('2026-03-01T12:00:00Z');
const hours = (h: number) => new Date(now.getTime() - h * 3_600_000);
const review = (over: Partial<ReviewLite>): ReviewLite => ({
  rating: 3,
  sentiment: null,
  topic: null,
  createdAt: hours(1),
  repliedAt: null,
  replyStatus: 'NONE',
  ...over,
});

describe('observatory stats', () => {
  it('averages response time only over measured replies', () => {
    expect(averageResponseHours([review({})])).toBeNull();
    expect(
      averageResponseHours([
        review({ createdAt: hours(10), repliedAt: hours(8) }),
        review({ createdAt: hours(10), repliedAt: hours(4) }),
        review({}),
      ]),
    ).toBe(4);
  });

  it('counts recurring negative topics (2+) only', () => {
    const rows = [
      review({ sentiment: 'negative', topic: 'usability' }),
      review({ sentiment: 'negative', topic: 'usability' }),
      review({ sentiment: 'negative', topic: 'price' }),
      review({ sentiment: 'positive', topic: 'price' }),
    ];
    expect(topRecurringIssues(rows)).toEqual([{ topic: 'usability', count: 2 }]);
  });

  it('buckets sentiment by week, newest last', () => {
    const trend = sentimentTrend([review({ sentiment: 'negative', createdAt: hours(2) }), review({ sentiment: 'positive', createdAt: hours(24 * 9) })], 3, now);
    expect(trend).toHaveLength(3);
    expect(trend[2].negative).toBe(1);
    expect(trend[1].positive).toBe(1);
  });
});
