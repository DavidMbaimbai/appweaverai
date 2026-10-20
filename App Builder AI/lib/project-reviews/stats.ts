export type ReviewStats = {
  total: number;
  averageRating: number;
  sentiment: { positive: number; neutral: number; negative: number; unknown: number };
  topics: Array<{ topic: string; count: number }>;
};

export function summarizeReviews(
  reviews: Array<{ rating: number; sentiment: string | null; topic: string | null }>,
): ReviewStats {
  const sentiment = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
  const topicCounts = new Map<string, number>();
  let sum = 0;
  for (const r of reviews) {
    sum += r.rating;
    if (r.sentiment === 'positive' || r.sentiment === 'neutral' || r.sentiment === 'negative') {
      sentiment[r.sentiment] += 1;
    } else sentiment.unknown += 1;
    if (r.topic) topicCounts.set(r.topic, (topicCounts.get(r.topic) ?? 0) + 1);
  }
  return {
    total: reviews.length,
    averageRating: reviews.length ? Math.round((sum / reviews.length) * 10) / 10 : 0,
    sentiment,
    topics: [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
  };
}
