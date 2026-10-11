import { describe, expect, it } from 'vitest';

import { isContentKind, parseContentVariants } from './content-assistant';

describe('parseContentVariants', () => {
  it('reads a JSON array wrapped in prose', () => {
    expect(parseContentVariants('Here: ["One", " Two ", "", 3, "Three", "Four"]')).toEqual([
      'One',
      'Two',
      'Three',
    ]);
  });

  it('returns an empty list for invalid output', () => {
    expect(parseContentVariants('no json')).toEqual([]);
    expect(parseContentVariants('[oops')).toEqual([]);
  });
});

describe('isContentKind', () => {
  it('accepts only known kinds', () => {
    expect(isContentKind('about')).toBe(true);
    expect(isContentKind('poem')).toBe(false);
  });
});
