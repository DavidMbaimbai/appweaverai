import { describe, expect, it } from 'vitest';

import { parseAdvert } from '@/lib/social/adverts';

const ok = (message: string) => JSON.stringify({ title: 'T', message });

describe('parseAdvert', () => {
  it('accepts a clean advert', () => {
    expect(
      parseAdvert(ok('Turn your idea into a real app. https://appweaverai.com #AI')),
    ).toMatchObject({ title: 'T' });
  });

  it('rejects invented claims, investor talk, missing link and long text', () => {
    expect(parseAdvert(ok('Used by 10,000 users https://appweaverai.com'))).toBeNull();
    expect(parseAdvert(ok('Guaranteed results https://appweaverai.com'))).toBeNull();
    expect(parseAdvert(ok('Invest in us https://appweaverai.com'))).toBeNull();
    expect(parseAdvert(ok('Build apps fast'))).toBeNull();
    expect(parseAdvert(ok(`${'a'.repeat(300)} https://appweaverai.com`))).toBeNull();
    expect(parseAdvert('not json')).toBeNull();
  });
});
