import { describe, expect, it } from 'vitest';

import { isValidTimeZone, zonedTimeToUtc } from '@/lib/ads/schedule';

describe('zonedTimeToUtc', () => {
  it('converts across zones, including DST and half-hour offsets', () => {
    expect(zonedTimeToUtc('2026-11-02T09:30', 'UTC')?.toISOString()).toBe('2026-11-02T09:30:00.000Z');
    expect(zonedTimeToUtc('2026-07-01T09:00', 'America/New_York')?.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedTimeToUtc('2026-12-01T09:00', 'America/New_York')?.toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(zonedTimeToUtc('2026-11-02T09:00', 'Asia/Kolkata')?.toISOString()).toBe('2026-11-02T03:30:00.000Z');
    expect(zonedTimeToUtc('2026-11-02T09:00', 'Pacific/Auckland')?.toISOString()).toBe('2026-11-01T20:00:00.000Z');
  });

  it('rejects bad input', () => {
    expect(zonedTimeToUtc('tomorrow', 'UTC')).toBeNull();
    expect(zonedTimeToUtc('2026-11-02T09:00', 'Mars/Base')).toBeNull();
    expect(isValidTimeZone('Europe/London')).toBe(true);
  });
});
