import { describe, expect, it } from 'vitest';
import { getAuthSessionStatus, shouldShowAuthModal } from './session-status';

describe('auth session status and modal gating', () => {
  it('resolves authenticated after an OAuth callback session is available', () => {
    expect(
      getAuthSessionStatus({
        isPending: false,
        hasUser: true,
      }),
    ).toBe('authenticated');
  });

  it('does not treat loading as logged out', () => {
    expect(
      getAuthSessionStatus({
        isPending: true,
        hasUser: false,
      }),
    ).toBe('loading');
  });

  it('does not reopen the login modal while the session is authenticated', () => {
    expect(
      shouldShowAuthModal({
        requestedOpen: true,
        status: 'authenticated',
      }),
    ).toBe(false);
  });

  it('shows the login modal for requested protected actions only when unauthenticated', () => {
    expect(
      shouldShowAuthModal({
        requestedOpen: true,
        status: 'unauthenticated',
      }),
    ).toBe(true);
  });
});
