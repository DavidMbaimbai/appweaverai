import { describe, expect, it } from 'vitest';

import { decideResponseState } from './response-state';
import { formatEvidenceForPrompt, redactSensitive, selectRelevantFeatures, type EvidenceBundle } from './evidence-format';

const on = { enabled: true, autoReplyPositive: true };
const positive = { rating: 5, body: 'Lovely app, thanks!', sentiment: 'positive', urgency: 'low' };

describe('decideResponseState', () => {
  it('allows automation only for owner-enabled, clearly positive, low-risk reviews', () => {
    expect(decideResponseState({ review: positive, settings: on, hasRelevantEvidence: false }).state).toBe('APPROVED_FOR_AUTOMATION');
    expect(
      decideResponseState({ review: positive, settings: { enabled: true, autoReplyPositive: false }, hasRelevantEvidence: false }).state,
    ).toBe('READY_FOR_REVIEW');
  });

  it.each([
    ['payment', 'My payment failed'],
    ['booking', 'My booking disappeared'],
    ['security', 'I think my password leaked'],
    ['legal', 'I will sue you'],
  ])('escalates %s mentions, even in positive reviews', (_name, body) => {
    expect(
      decideResponseState({ review: { ...positive, body }, settings: on, hasRelevantEvidence: true }).state,
    ).toBe('ESCALATION_REQUIRED');
  });

  it('escalates negative sentiment, low ratings and high urgency', () => {
    expect(decideResponseState({ review: { ...positive, sentiment: 'negative' }, settings: on, hasRelevantEvidence: true }).state).toBe('ESCALATION_REQUIRED');
    expect(decideResponseState({ review: { ...positive, rating: 2 }, settings: on, hasRelevantEvidence: true }).state).toBe('ESCALATION_REQUIRED');
    expect(decideResponseState({ review: { ...positive, urgency: 'high' }, settings: on, hasRelevantEvidence: true }).state).toBe('ESCALATION_REQUIRED');
  });

  it('needs investigation for non-positive reviews with no evidence', () => {
    const neutral = { rating: 3, body: 'The page is slow to load', sentiment: 'neutral', urgency: 'low' };
    expect(decideResponseState({ review: neutral, settings: on, hasRelevantEvidence: false }).state).toBe('NEEDS_INVESTIGATION');
    expect(decideResponseState({ review: neutral, settings: on, hasRelevantEvidence: true }).state).toBe('READY_FOR_REVIEW');
    expect(decideResponseState({ review: { ...neutral, sentiment: null }, settings: on, hasRelevantEvidence: false }).state).toBe('NEEDS_INVESTIGATION');
  });
});

describe('redactSensitive', () => {
  it('removes emails, phone numbers and key-like tokens', () => {
    const out = redactSensitive('mail me@x.com or +44 7700 900123, key sk_live_abcdefghij123456 Bearer abcdefghijklmnop');
    expect(out).not.toMatch(/me@x\.com|7700|sk_live|abcdefghijklmnop/);
  });
});

describe('evidence retrieval and formatting', () => {
  const ledger = [
    { key: 'payments-paypal', name: 'PayPal payments', summary: null, status: 'PLANNED', evidence: [{ type: 'scan_absent', ref: 'scan:9-files', detail: 'x' }] },
    { key: 'blog-content', name: 'Blog / articles', summary: null, status: 'IMPLEMENTED', evidence: [{ type: 'file', ref: 'a/blog/x.md', detail: '' }] },
  ];

  it('retrieves only features related to the review text', () => {
    const hits = selectRelevantFeatures('Can I pay with PayPal?', ledger);
    expect(hits.map((h) => h.key)).toEqual(['payments-paypal']);
  });

  it('marks confirmed-absent features explicitly in the prompt context', () => {
    const bundle: EvidenceBundle = {
      gatheredAt: 'now',
      features: [{ key: 'payments-paypal', name: 'PayPal payments', status: 'PLANNED', confirmedAbsent: true, summary: null, refs: ['scan:9-files'] }],
      deployment: { version: 3, status: 'LIVE', publishedAt: null },
      health: null,
      smoke: null,
      incidents: [],
      recurring: [],
      knowledge: [],
      statusWebhook: null,
    };
    const text = formatEvidenceForPrompt(bundle);
    expect(text).toMatch(/PayPal payments \[PLANNED\] ABSENT/);
    expect(text).toMatch(/Latest smoke check: none recorded/);
  });
});
