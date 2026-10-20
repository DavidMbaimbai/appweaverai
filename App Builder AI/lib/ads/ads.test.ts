import { describe, expect, it } from 'vitest';

import { attributionFromSearch, parseAttributionCookie } from '@/lib/ads/attribution-cookie';
import { parseAdCopy } from '@/lib/ads/copy';
import { dailyBudgetCents, MAX_DAILY_BUDGET_CENTS } from '@/lib/ads/meta';
import { adsToPause } from '@/lib/ads/optimize';

describe('attribution', () => {
  it('reads UTM params and round-trips through the cookie', () => {
    const attr = attributionFromSearch(
      new URLSearchParams('utm_source=facebook&utm_content=abc123&utm_campaign=aw_auto'),
    );
    expect(attr).toMatchObject({ source: 'facebook', content: 'abc123' });
    const cookie = `x=1; aw_attr=${encodeURIComponent(JSON.stringify(attr))}`;
    expect(parseAttributionCookie(cookie)).toEqual(attr);
  });

  it('ignores missing, junk and unsafe values', () => {
    expect(attributionFromSearch(new URLSearchParams('foo=bar'))).toBeNull();
    expect(attributionFromSearch(new URLSearchParams('utm_source=<script>'))).toBeNull();
    expect(parseAttributionCookie('aw_attr=%7Bnot-json')).toBeNull();
  });
});

describe('budget cap', () => {
  it('can be lowered but never raised above the hard cap', () => {
    process.env.META_ADS_DAILY_BUDGET_CENTS = '99999';
    expect(dailyBudgetCents()).toBe(MAX_DAILY_BUDGET_CENTS);
    process.env.META_ADS_DAILY_BUDGET_CENTS = '200';
    expect(dailyBudgetCents()).toBe(200);
    delete process.env.META_ADS_DAILY_BUDGET_CENTS;
  });
});

describe('adsToPause', () => {
  it('pauses judged ads without sign-ups but keeps the best', () => {
    const ids = adsToPause([
      { id: 'a', spendCents: 400, clicks: 30, signups: 2 },
      { id: 'b', spendCents: 350, clicks: 10, signups: 0 },
      { id: 'c', spendCents: 100, clicks: 2, signups: 0 },
    ]);
    expect(ids).toEqual(['b']);
  });

  it('never pauses the only ad, even with no results', () => {
    expect(adsToPause([{ id: 'a', spendCents: 900, clicks: 0, signups: 0 }])).toEqual([]);
  });
});

describe('parseAdCopy', () => {
  const copy = (o: object) => JSON.stringify({ headline: 'Build apps', primaryText: 'Turn ideas into apps today.', imagePrompt: 'Soft gradient', ...o });

  it('accepts clean copy', () => {
    expect(parseAdCopy(copy({}))).not.toBeNull();
  });

  it('rejects overlong, invented-claim, or incomplete copy', () => {
    expect(parseAdCopy(copy({ headline: 'x'.repeat(41) }))).toBeNull();
    expect(parseAdCopy(copy({ primaryText: 'Used by 5,000 users' }))).toBeNull();
    expect(parseAdCopy(copy({ imagePrompt: '' }))).toBeNull();
  });
});
