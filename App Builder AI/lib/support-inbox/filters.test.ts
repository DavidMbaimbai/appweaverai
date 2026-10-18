import { describe, expect, it } from 'vitest';

import { shouldAutoReply } from '@/lib/support-inbox/filters';

const headers = (values: Record<string, string> = {}) => ({
  get: (name: string) => values[name],
});
const own = ['david.mbaimbai@appweaverai.com'];

describe('shouldAutoReply', () => {
  it('replies to a normal customer email', () => {
    expect(
      shouldAutoReply({ fromAddress: 'jane@example.com', ownAddresses: own, headers: headers() })
        .reply,
    ).toBe(true);
  });

  it.each([
    ['own address', 'David.Mbaimbai@appweaverai.com', {}],
    ['no-reply sender', 'noreply@shop.com', {}],
    ['auto-submitted', 'jane@example.com', { 'auto-submitted': 'auto-replied' }],
    ['bulk precedence', 'jane@example.com', { precedence: 'bulk' }],
    ['mailing list', 'jane@example.com', { 'list-id': '<x.example.com>' }],
  ])('skips %s', (_name, from, h) => {
    expect(
      shouldAutoReply({ fromAddress: from, ownAddresses: own, headers: headers(h) }).reply,
    ).toBe(false);
  });

  it('honours stop/unsubscribe requests', () => {
    const base = { fromAddress: 'jane@example.com', ownAddresses: own, headers: headers() };
    expect(shouldAutoReply({ ...base, subject: 'Unsubscribe' }).reply).toBe(false);
    expect(shouldAutoReply({ ...base, subject: 'Hi', body: 'STOP\n\nthanks' }).reply).toBe(false);
    expect(shouldAutoReply({ ...base, subject: 'Help', body: 'Please stop charging me' }).reply).toBe(true);
  });
});
