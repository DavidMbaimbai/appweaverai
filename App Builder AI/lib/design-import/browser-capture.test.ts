import { describe, expect, it } from 'vitest';
import { captureWebsiteReference } from './browser-capture';
import path from 'node:path';
import os from 'node:os';
import { rm } from 'node:fs/promises';

describe('browser-capture', () => {
  it('should have captureWebsiteReference exported', () => {
    expect(captureWebsiteReference).toBeDefined();
  });

  it('should throw for invalid URLs', async () => {
    await expect(captureWebsiteReference('not-a-url')).rejects.toThrow();
  });

  it('should throw for private URLs', async () => {
    await expect(captureWebsiteReference('https://localhost')).rejects.toThrow();
  });
});
