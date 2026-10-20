export type ReviewLite = {
  rating: number;
  sentiment: string | null;
  topic: string | null;
  createdAt: Date;
  repliedAt: Date | null;
  replyStatus: string;
};

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Weekly sentiment counts, oldest first. */
export function sentimentTrend(reviews: ReviewLite[], weeks = 8, now = new Date()) {
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    weekStart: new Date(now.getTime() - (weeks - i) * WEEK),
    positive: 0,
    neutral: 0,
    negative: 0,
  }));
  for (const review of reviews) {
    const age = now.getTime() - review.createdAt.getTime();
    if (age < 0 || age >= weeks * WEEK) continue;
    const bucket = buckets[weeks - 1 - Math.floor(age / WEEK)];
    if (review.sentiment === 'positive' || review.sentiment === 'neutral' || review.sentiment === 'negative') {
      bucket[review.sentiment] += 1;
    }
  }
  return buckets;
}

/** Average hours to reply, using only reviews that actually have a recorded reply time. Null when nothing was measured. */
export function averageResponseHours(reviews: ReviewLite[]): number | null {
  const measured = reviews.filter((r) => r.repliedAt && r.repliedAt >= r.createdAt);
  if (!measured.length) return null;
  const total = measured.reduce((sum, r) => sum + (r.repliedAt!.getTime() - r.createdAt.getTime()), 0);
  return Math.round((total / measured.length / 3_600_000) * 10) / 10;
}

export function topRecurringIssues(reviews: ReviewLite[], limit = 5) {
  const counts = new Map<string, number>();
  for (const review of reviews) {
    if (review.sentiment !== 'negative' || !review.topic) continue;
    counts.set(review.topic, (counts.get(review.topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function isUnresolvedComplaint(review: { rating: number; sentiment: string | null; replyStatus: string }) {
  return (review.sentiment === 'negative' || review.rating <= 2) && review.replyStatus !== 'SENT';
}
