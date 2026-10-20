import { beforeAll, describe, expect, it } from 'vitest';

import {
  isSafePublicUrl,
  unsubscribeUrl,
  verifyPublished,
  verifyUnsubscribeToken,
  withFooter,
} from '@/lib/outreach/compliance';
import { parseDraft, parseExtractedInvestors } from '@/lib/outreach/discover';

beforeAll(() => {
  process.env.OUTREACH_SECRET = 'test-secret';
});

describe('unsubscribe tokens', () => {
  it('verifies only the matching address', () => {
    const url = new URL(unsubscribeUrl('Jane@Fund.com'));
    const token = url.searchParams.get('token')!;
    expect(url.searchParams.get('email')).toBe('jane@fund.com');
    expect(verifyUnsubscribeToken('jane@fund.com', token)).toBe(true);
    expect(verifyUnsubscribeToken('other@fund.com', token)).toBe(false);
    expect(verifyUnsubscribeToken('jane@fund.com', 'bad')).toBe(false);
  });

  it('puts the address and opt-out link in every email footer', () => {
    const footer = withFooter({ body: 'Hi <b>', email: 'jane@fund.com', postalAddress: '1 Main St' });
    expect(footer.text).toContain('1 Main St');
    expect(footer.text).toContain(footer.link);
    expect(footer.html).toContain('&lt;b&gt;');
  });
});

describe('published-contact verification', () => {
  const page = 'Contact Jane at jane@fund.com or +1 555 0100';

  it('drops emails and phones the page does not contain', () => {
    expect(verifyPublished('jane@fund.com', page)).toBe('jane@fund.com');
    expect(verifyPublished('made.up@fund.com', page)).toBeNull();
  });

  it('only keeps extracted contacts that were really published', () => {
    const [lead] = parseExtractedInvestors(
      '[{"name":"Jane","firm":"Fund","focus":"AI seed","email":"guess@fund.com","phone":"+1 555 0100"}]',
      page,
    );
    expect(lead.email).toBeNull();
    expect(lead.phone).toBe('+1 555 0100');
  });
});

describe('isSafePublicUrl', () => {
  it.each(['http://fund.com', 'https://localhost/x', 'https://127.0.0.1/', 'https://intranet/'])(
    'rejects %s',
    (url) => expect(isSafePublicUrl(url)).toBe(false),
  );
  it('accepts public https urls', () => expect(isSafePublicUrl('https://fund.com/team')).toBe(true));
});

describe('parseDraft', () => {
  it('requires a subject and body', () => {
    expect(() => parseDraft('{"subject":"","body":"x"}')).toThrow();
    expect(parseDraft('{"subject":"Hi","body":"Body","talkingPoints":["a"]}').talkingPoints).toBe('- a');
  });
});
