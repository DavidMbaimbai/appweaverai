import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/anthropic', () => ({ getAnthropicClient: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { parseReviewAnalysis, REVIEW_SYSTEM_PROMPT, sanitizeDraft } from './ai';
import { parseSupportAnswer, SUPPORT_SYSTEM_PROMPT } from './support';

describe('parseReviewAnalysis', () => {
  it('parses classification and normalizes unknown values', () => {
    const a = parseReviewAnalysis(
      '```json\n{"topic":"Delivery","sentiment":"negative","urgency":"weird","reply":"Sorry to hear that."}\n```',
    );
    expect(a).toEqual({ topic: 'delivery', sentiment: 'negative', urgency: null, reply: 'Sorry to hear that.' });
  });

  it('drops drafts that promise refunds or include links', () => {
    expect(sanitizeDraft("We'll issue a full refund.")).toBe('');
    expect(sanitizeDraft('See https://x.com')).toBe('');
    expect(sanitizeDraft('Thank you so much!')).toBe('Thank you so much!');
  });

  it('forbids fabrication in the prompts', () => {
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/ONLY facts in <business_info>/);
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/NEVER offer, promise/);
    expect(SUPPORT_SYSTEM_PROMPT).toMatch(/ONLY the text inside <knowledge>/);
  });
});

describe('parseSupportAnswer', () => {
  it('returns null when the model does not know or output is malformed', () => {
    expect(parseSupportAnswer('{"answer": null}')).toBeNull();
    expect(parseSupportAnswer('nonsense')).toBeNull();
    expect(parseSupportAnswer('{"answer":"We open at 9."}')).toBe('We open at 9.');
  });
});
