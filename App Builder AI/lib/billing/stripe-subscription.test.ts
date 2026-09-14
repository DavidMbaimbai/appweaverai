import { describe, expect, it } from 'vitest';

import { isValidCheckoutSessionId } from '@/lib/billing/stripe-subscription';

describe('isValidCheckoutSessionId', () => {
  it('accepts a well-formed live checkout session id', () => {
    expect(isValidCheckoutSessionId('cs_live_a1B2c3D4e5')).toBe(true);
  });

  it('accepts a well-formed test checkout session id', () => {
    expect(isValidCheckoutSessionId('cs_test_a1B2c3D4e5')).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidCheckoutSessionId('  cs_test_abc123  ')).toBe(true);
  });

  it('rejects ids missing the cs_ prefix', () => {
    expect(isValidCheckoutSessionId('sub_test_abc123')).toBe(false);
  });

  it('rejects ids with an invalid environment segment', () => {
    expect(isValidCheckoutSessionId('cs_staging_abc123')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidCheckoutSessionId('')).toBe(false);
  });

  it('rejects SQL/script-injection-style input', () => {
    expect(isValidCheckoutSessionId("cs_test_abc'; DROP TABLE users;--")).toBe(
      false,
    );
  });
});
