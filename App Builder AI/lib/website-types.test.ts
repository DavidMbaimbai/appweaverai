import { describe, expect, it } from 'vitest';

import { getWebsiteType, withWebsiteTypeGuidance } from './website-types';

describe('website types', () => {
  it('looks types up by id and rejects unknown ones', () => {
    expect(getWebsiteType('portfolio')?.label).toBe('Portfolio');
    expect(getWebsiteType('nope')).toBeNull();
    expect(getWebsiteType(null)).toBeNull();
  });

  it('appends guidance only when a type is chosen', () => {
    expect(withWebsiteTypeGuidance('Make a site', null)).toBe('Make a site');
    expect(withWebsiteTypeGuidance('Make a site', getWebsiteType('blog'))).toContain(
      'Website type: Blog.',
    );
  });
});
