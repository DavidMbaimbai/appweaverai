import { flaggedKeywords } from './policy';

export const RESPONSE_STATES = [
  'READY_FOR_REVIEW',
  'NEEDS_INVESTIGATION',
  'ESCALATION_REQUIRED',
  'APPROVED_FOR_AUTOMATION',
] as const;
export type ResponseState = (typeof RESPONSE_STATES)[number];

const PAYMENT = /\b(payment|paid|pay|charged?|charging|billing|billed|invoice|card|checkout|refund\w*|double[- ]charge)\b/i;
const BOOKING = /\b(book(?:ed|ing|ings)?|reserv\w+|appointment|reschedul\w+|cancell?ed)\b/i;
const SECURITY = /\b(hack\w*|breach\w*|security|password|leak\w*|privacy|gdpr|stolen|phishing|unauthori[sz]ed|data protection)\b/i;

export type ResponseStateInput = {
  review: {
    rating: number;
    body: string;
    sentiment?: string | null;
    urgency?: string | null;
  };
  settings: { enabled: boolean; autoReplyPositive: boolean };
  /** Ledger features, owner knowledge or incidents relevant to what the review talks about. */
  hasRelevantEvidence: boolean;
};

export type ResponseStateDecision = { state: ResponseState; reasons: string[] };

/**
 * Pure routing for a drafted reply.
 * Escalation (payment / booking / security / legal / negative) always wins, then
 * missing evidence, then automation (only owner-enabled, clearly positive, low risk).
 */
export function decideResponseState(input: ResponseStateInput): ResponseStateDecision {
  const { review, settings } = input;
  const escalate: string[] = [];

  if (PAYMENT.test(review.body)) escalate.push('mentions payments');
  if (BOOKING.test(review.body)) escalate.push('mentions bookings');
  if (SECURITY.test(review.body)) escalate.push('mentions security or privacy');
  const legal = flaggedKeywords(review.body);
  if (legal.length) escalate.push(`legal/dispute keywords: ${legal.join(', ')}`);
  if (review.sentiment === 'negative') escalate.push('negative sentiment');
  if (review.urgency === 'high') escalate.push('high urgency');
  if (review.rating <= 2) escalate.push('rating 2 or below');
  if (escalate.length) return { state: 'ESCALATION_REQUIRED', reasons: escalate };

  const clearlyPositive =
    review.sentiment === 'positive' && review.urgency === 'low' && review.rating >= 4;

  if (!clearlyPositive && !input.hasRelevantEvidence) {
    return {
      state: 'NEEDS_INVESTIGATION',
      reasons: [
        review.sentiment ? `${review.sentiment} review without supporting evidence` : 'review could not be classified',
      ],
    };
  }

  if (clearlyPositive && settings.enabled && settings.autoReplyPositive) {
    return { state: 'APPROVED_FOR_AUTOMATION', reasons: [] };
  }
  return { state: 'READY_FOR_REVIEW', reasons: [] };
}

/** Automation requires both the policy decision and the evidence state to agree. */
export function mayAutoSend(state: ResponseState, policyAction: 'AUTO_SEND' | 'HOLD_FOR_APPROVAL') {
  return state === 'APPROVED_FOR_AUTOMATION' && policyAction === 'AUTO_SEND';
}
