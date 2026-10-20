export type ReviewSentiment = 'positive' | 'neutral' | 'negative';
export type ReviewUrgency = 'low' | 'medium' | 'high';

export type ReviewForPolicy = {
  rating: number;
  body: string;
  sentiment?: string | null;
  urgency?: string | null;
};

export type ReplyDecision =
  | { action: 'AUTO_SEND'; reasons: [] }
  | { action: 'HOLD_FOR_APPROVAL'; reasons: string[]; notifyOwner: boolean };

const FLAG_PATTERN =
  /\b(refund|refunds|chargeback|charge ?back|money back|lawyer|attorney|legal|lawsuit|sue|suing|court|dispute|disputed|fraud|scam|police|report you|threat|threaten|defam\w*|trading standards|consumer (?:protection|authority))\b/i;

export function flaggedKeywords(text: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(FLAG_PATTERN.source, 'gi');
  for (const m of text.matchAll(re)) found.add(m[0].toLowerCase());
  return [...found];
}

export function normalizeSentiment(value: unknown): ReviewSentiment | null {
  return value === 'positive' || value === 'neutral' || value === 'negative' ? value : null;
}

export function normalizeUrgency(value: unknown): ReviewUrgency | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

/**
 * A reply is only auto-sent when the owner opted in AND the review is clearly
 * positive and unflagged. Everything else (including unknown classification)
 * is held for the owner to approve.
 */
export function decideReply(
  review: ReviewForPolicy,
  settings: { enabled: boolean; autoReplyPositive: boolean },
): ReplyDecision {
  const reasons: string[] = [];
  const keywords = flaggedKeywords(review.body);
  if (keywords.length) reasons.push(`flagged keywords: ${keywords.join(', ')}`);
  if (review.sentiment !== 'positive' && review.sentiment !== 'neutral') {
    reasons.push(review.sentiment === 'negative' ? 'negative sentiment' : 'sentiment unknown');
  }
  if (review.urgency === 'high') reasons.push('high urgency');
  else if (review.urgency !== 'low' && review.urgency !== 'medium') reasons.push('urgency unknown');
  if (review.rating < 4) reasons.push('rating below 4');
  if (!settings.enabled) reasons.push('reviews assistant disabled');
  if (!settings.autoReplyPositive) reasons.push('auto-reply not enabled by owner');
  if (review.sentiment === 'neutral') reasons.push('neutral sentiment');

  if (reasons.length === 0) return { action: 'AUTO_SEND', reasons: [] };

  const notifyOwner =
    review.urgency === 'high' ||
    review.sentiment === 'negative' ||
    keywords.length > 0 ||
    review.rating <= 2;
  return { action: 'HOLD_FOR_APPROVAL', reasons, notifyOwner };
}
