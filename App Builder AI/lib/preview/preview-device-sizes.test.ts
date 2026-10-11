import { describe, expect, it } from 'vitest';

import {
  applyPreviewOrientation,
  getPreviewDevicePreset,
} from '@/lib/preview/preview-device-sizes';

describe('applyPreviewOrientation', () => {
  it('swaps width and height in landscape', () => {
    const phone = getPreviewDevicePreset('iphone-17-pro');
    const landscape = applyPreviewOrientation(phone, true);
    expect(landscape.width).toBe(phone.height);
    expect(landscape.height).toBe(phone.width);
  });

  it('leaves portrait and full-size untouched', () => {
    const phone = getPreviewDevicePreset('iphone-17-pro');
    expect(applyPreviewOrientation(phone, false)).toBe(phone);
    const full = getPreviewDevicePreset('full');
    expect(applyPreviewOrientation(full, true)).toBe(full);
  });
});
