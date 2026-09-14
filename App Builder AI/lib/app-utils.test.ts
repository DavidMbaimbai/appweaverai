import { describe, expect, it } from 'vitest';

import {
  formatFileSize,
  formatRelativeTime,
  slugify,
  slugifyUsername,
  uniqueSlugWithSuffix,
} from '@/lib/app-utils';

describe('slugify', () => {
  it('lowercases and hyphenates non-alphanumeric runs', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--Weird--Name--')).toBe('weird-name');
  });

  it('respects maxLength', () => {
    expect(slugify('a'.repeat(100), 10)).toHaveLength(10);
  });

  it('returns empty string for input with no alphanumerics', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('slugifyUsername', () => {
  it('caps usernames at 40 characters', () => {
    const result = slugifyUsername('Very Long Username '.repeat(5));
    expect(result.length).toBeLessThanOrEqual(40);
  });
});

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('uniqueSlugWithSuffix', () => {
  it('returns the base slug when it does not already exist', async () => {
    const result = await uniqueSlugWithSuffix('My Project', async () => false, 'project');
    expect(result).toBe('my-project');
  });

  it('appends an incrementing numeric suffix until a free slug is found', async () => {
    const taken = new Set(['my-project', 'my-project-1', 'my-project-2']);
    const result = await uniqueSlugWithSuffix(
      'My Project',
      async (candidate) => taken.has(candidate),
      'project',
    );
    expect(result).toBe('my-project-3');
  });

  it('falls back to the provided fallback when base slugifies to empty', async () => {
    const result = await uniqueSlugWithSuffix('!!!', async () => false, 'fallback');
    expect(result).toBe('fallback');
  });
});

describe('formatRelativeTime', () => {
  it('reports "Just now" for very recent timestamps', () => {
    expect(formatRelativeTime(new Date())).toBe('Just now');
  });

  it('reports minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60_000);
    expect(formatRelativeTime(date)).toBe('5m ago');
  });

  it('reports hours ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60_000);
    expect(formatRelativeTime(date)).toBe('3h ago');
  });

  it('reports days ago', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    expect(formatRelativeTime(date)).toBe('2d ago');
  });

  it('accepts an ISO string', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('Just now');
  });
});
