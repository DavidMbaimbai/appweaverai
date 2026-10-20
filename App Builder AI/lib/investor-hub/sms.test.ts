import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildContainerPayload, buildPublishPayload, connectionPlatform, hasInstagramImage } from '@/lib/project-marketing/instagram';

import { callEffect, insideSendWindow, isStopKeyword, smsBlockReason, verifyTwilioSignature } from './sms';

const base = {
  phone: '+14155550123',
  timezone: 'America/New_York',
  smsConsent: true,
  smsConsentAt: new Date('2026-01-01T00:00:00Z'),
  smsOptedOut: false,
  investorOptedOut: false,
  now: new Date('2026-06-10T16:00:00Z'), // 12:00 in New York
};

describe('quiet hours', () => {
  it('uses investor-local time', () => {
    expect(insideSendWindow(new Date('2026-06-10T16:00:00Z'), 'America/New_York')).toBe(true);
    expect(insideSendWindow(new Date('2026-06-10T16:00:00Z'), 'Asia/Tokyo')).toBe(false); // 01:00
  });
  it('is inclusive at 08:00 and exclusive at 20:00', () => {
    expect(insideSendWindow(new Date('2026-06-10T08:00:00Z'), 'UTC')).toBe(true);
    expect(insideSendWindow(new Date('2026-06-10T20:00:00Z'), 'UTC')).toBe(false);
    expect(insideSendWindow(new Date('2026-06-10T07:59:00Z'), 'UTC')).toBe(false);
  });
  it('blocks unknown time zones', () => {
    expect(insideSendWindow(new Date(), null)).toBe(false);
    expect(insideSendWindow(new Date(), 'Not/AZone')).toBe(false);
  });
});

describe('smsBlockReason', () => {
  it('allows a consented investor inside the window', () => {
    expect(smsBlockReason(base)).toBeNull();
  });
  it('requires recorded consent', () => {
    expect(smsBlockReason({ ...base, smsConsent: false })).toMatch(/consent/i);
    expect(smsBlockReason({ ...base, smsConsentAt: null })).toMatch(/consent/i);
  });
  it('blocks opt-outs, bad numbers, and quiet hours', () => {
    expect(smsBlockReason({ ...base, smsOptedOut: true })).toMatch(/STOP/);
    expect(smsBlockReason({ ...base, investorOptedOut: true })).toMatch(/opted out/);
    expect(smsBlockReason({ ...base, phone: '4155550123' })).toMatch(/international/);
    expect(smsBlockReason({ ...base, now: new Date('2026-06-10T04:00:00Z') })).toMatch(/Quiet hours/);
  });
});

describe('stop keywords and call outcomes', () => {
  it('detects STOP variants only as whole messages', () => {
    expect(isStopKeyword(' stop. ')).toBe(true);
    expect(isStopKeyword('Unsubscribe')).toBe(true);
    expect(isStopKeyword('please do not stop')).toBe(false);
  });
  it('maps outcomes to CRM effects', () => {
    expect(callEffect('MEETING_BOOKED').stage).toBe('MEETING_SCHEDULED');
    expect(callEffect('DO_NOT_CALL')).toMatchObject({ stage: 'DECLINED', optOut: true });
    expect(callEffect('VOICEMAIL')).toEqual({ stage: null, stopSequence: false, optOut: false });
  });
});

describe('verifyTwilioSignature', () => {
  it('accepts a valid signature and rejects tampering', () => {
    const url = 'https://example.com/api/investor-hub/sms';
    const params = { From: '+14155550123', Body: 'STOP' };
    const sig = createHmac('sha1', 'tok').update(`${url}BodySTOPFrom+14155550123`).digest('base64');
    expect(verifyTwilioSignature('tok', url, params, sig)).toBe(true);
    expect(verifyTwilioSignature('tok', url, { ...params, Body: 'GO' }, sig)).toBe(false);
    expect(verifyTwilioSignature('tok', url, params, null)).toBe(false);
  });
});

describe('instagram payloads', () => {
  it('builds container and publish bodies', () => {
    expect(buildContainerPayload('hi', 'https://x.com/a.jpg')).toEqual({ image_url: 'https://x.com/a.jpg', caption: 'hi' });
    expect(buildContainerPayload('a'.repeat(3000), 'https://x.com/a.jpg').caption).toHaveLength(2200);
    expect(buildPublishPayload('123')).toEqual({ creation_id: '123' });
  });
  it('requires an https image and uses the Facebook connection', () => {
    expect(hasInstagramImage('https://x.com/a.jpg')).toBe(true);
    expect(hasInstagramImage('http://x.com/a.jpg')).toBe(false);
    expect(hasInstagramImage(null)).toBe(false);
    expect(connectionPlatform('INSTAGRAM')).toBe('FACEBOOK');
    expect(connectionPlatform('X')).toBe('X');
  });
});
