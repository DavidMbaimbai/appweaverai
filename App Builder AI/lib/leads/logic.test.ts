import { describe, expect, it } from 'vitest';

import {
  basicScore,
  buildQualificationInput,
  dedupeByEmail,
  leadFromSubmissionData,
  parseQualification,
  sendBlockReason,
} from './logic';

describe('dedupe', () => {
  it('collapses case-insensitive emails, fills gaps, keeps email-less rows', () => {
    const { unique, duplicates } = dedupeByEmail([
      { name: 'Ann', email: 'Ann@X.com', phone: null },
      { name: 'Ann B', email: ' ann@x.com ', phone: '555' },
      { name: 'No Email', email: null },
      { name: 'No Email 2', email: null },
    ]);
    expect(duplicates).toBe(1);
    expect(unique).toHaveLength(3);
    expect(unique[0]).toMatchObject({ name: 'Ann', email: 'ann@x.com', phone: '555' });
  });

  it('extracts leads from arbitrary form fields and rejects empty ones', () => {
    expect(leadFromSubmissionData('contact', { Name: 'Bo', Email: 'BO@a.io', message: 'hi' })).toMatchObject({ name: 'Bo', email: 'bo@a.io', source: 'form:contact', consent: false });
    expect(leadFromSubmissionData('x', { foo: 'bar' })).toBeNull();
  });
});

describe('qualification input', () => {
  const lead = { name: 'Ann', email: null, phone: '', source: 'widget', utm: { source: 'fb', evil: '<x>' }, notes: '', status: 'NEW', consent: false };

  it('omits empty fields and unknown utm keys', () => {
    const input = buildQualificationInput(lead);
    expect(input).toEqual({ name: 'Ann', source: 'widget', status: 'NEW', utm: 'source=fb', consentedToEmail: 'no' });
    expect('email' in input).toBe(false);
  });

  it('clamps scores and requires reasons', () => {
    expect(parseQualification('x {"score": 250, "reasons": ["notes ask for demo"]}')?.score).toBe(100);
    expect(parseQualification('{"score": -3, "reasons": ["a"]}')?.score).toBe(0);
    expect(parseQualification('{"score": 50, "reasons": []}')).toBeNull();
    expect(parseQualification('nope')).toBeNull();
  });

  it('fallback score only reflects completeness', () => {
    expect(basicScore({}).score).toBe(0);
    expect(basicScore({ email: 'a@b.co', consentedToEmail: 'yes' }).score).toBe(50);
  });
});

describe('send guard', () => {
  const ok = { email: 'a@b.co', consent: true, optedOut: false, suppressed: false, sentToday: 0, dailyLimit: 5, draftStatus: 'DRAFT' };
  it('allows only consented, unsuppressed, under-limit drafts', () => {
    expect(sendBlockReason(ok)).toBeNull();
    expect(sendBlockReason({ ...ok, consent: false })).toMatch(/consent/);
    expect(sendBlockReason({ ...ok, suppressed: true })).toMatch(/opted out/);
    expect(sendBlockReason({ ...ok, sentToday: 5 })).toMatch(/limit/);
    expect(sendBlockReason({ ...ok, draftStatus: 'SENT' })).toMatch(/already/);
  });
});
