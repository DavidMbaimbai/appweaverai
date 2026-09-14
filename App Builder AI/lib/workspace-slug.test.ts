import { describe, expect, it } from 'vitest';

import {
  defaultWorkspaceSlugFromUser,
  normalizeWorkspaceSlug,
  validateWorkspaceSlug,
  WORKSPACE_SLUG_PATTERN,
} from '@/lib/workspace-slug';

describe('normalizeWorkspaceSlug', () => {
  it('strips a leading @ and slugifies', () => {
    expect(normalizeWorkspaceSlug('@David_M')).toBe('david-m');
  });

  it('handles plain usernames', () => {
    expect(normalizeWorkspaceSlug('AppWeaver')).toBe('appweaver');
  });
});

describe('defaultWorkspaceSlugFromUser', () => {
  it('prefers the username when long enough', () => {
    expect(
      defaultWorkspaceSlugFromUser({ username: 'appweaver', name: 'Ignored Name' }),
    ).toBe('appweaver');
  });

  it('falls back to the name when username is too short', () => {
    expect(defaultWorkspaceSlugFromUser({ username: 'ab', name: 'Jane Doe' })).toBe(
      'jane-doe',
    );
  });

  it('falls back to "workspace" when neither slugifies to anything', () => {
    expect(defaultWorkspaceSlugFromUser({ username: '!!', name: '!!' })).toBe(
      'workspace',
    );
  });

  it('returns a short (< 3 char) slugified username as-is when the name is also unusable', () => {
    expect(defaultWorkspaceSlugFromUser({ username: 'a', name: '!!' })).toBe('a');
  });

  it('falls back to "workspace" when both are missing', () => {
    expect(defaultWorkspaceSlugFromUser({})).toBe('workspace');
  });
});

describe('validateWorkspaceSlug', () => {
  it('rejects slugs shorter than 3 characters', () => {
    expect(validateWorkspaceSlug('ab')).toMatch(/at least 3 characters/);
  });

  it('rejects slugs with invalid characters', () => {
    expect(validateWorkspaceSlug('Not Valid!')).toMatch(/lowercase letters/);
  });

  it('rejects slugs starting or ending with a hyphen', () => {
    expect(validateWorkspaceSlug('-invalid')).toMatch(/lowercase letters/);
    expect(validateWorkspaceSlug('invalid-')).toMatch(/lowercase letters/);
  });

  it('accepts a valid slug', () => {
    expect(validateWorkspaceSlug('valid-workspace-1')).toBeNull();
  });

  it('matches the exported pattern directly', () => {
    expect(WORKSPACE_SLUG_PATTERN.test('valid-slug')).toBe(true);
    expect(WORKSPACE_SLUG_PATTERN.test('in valid')).toBe(false);
  });
});
