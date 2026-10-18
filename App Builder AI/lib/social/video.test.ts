import { describe, expect, it } from 'vitest';

import { parseMp4Duration, validateMarketingVideo } from '@/lib/social/video';

function mvhd(timescale: number, duration: number) {
  const b = new Uint8Array(40);
  const v = new DataView(b.buffer);
  b.set([0x6d, 0x76, 0x68, 0x64], 4); // 'mvhd' (after a 4-byte size)
  v.setUint32(16 + 4, timescale); // offsets are relative to the type field at index 4
  v.setUint32(20 + 4, duration);
  return b;
}

describe('marketing video length', () => {
  it('reads duration from an mvhd box', () => {
    expect(parseMp4Duration(mvhd(1000, 150_000))).toBe(150);
    expect(parseMp4Duration(new Uint8Array(64))).toBeNull();
  });

  it('rejects videos over 3 minutes and accepts declared durations', async () => {
    expect(await validateMarketingVideo('https://x.test/v.mp4', 180)).toBeNull();
    expect(await validateMarketingVideo('https://x.test/v.mp4', 181)).toMatch(/at most 180s/);
  });
});
