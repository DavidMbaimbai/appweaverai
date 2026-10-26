import { describe, expect, it } from 'vitest';
import { getOAuthErrorMessage } from './oauth-errors';

describe('OAuth error messages', () => {
  it('shows a useful error for OAuth account-linking failures', () => {
    expect(getOAuthErrorMessage('account_not_linked')).toContain(
      'not linked to your AppWeaver account',
    );
  });

  it('does not mistake a token-exchange failure for an expired link', () => {
    expect(getOAuthErrorMessage('invalid_code')).toContain('Social sign-in');
    expect(getOAuthErrorMessage('invalid_code')).not.toMatch(/expired|already used/);
  });

  it('falls back to a generic useful sign-in error', () => {
    expect(getOAuthErrorMessage('some_provider_error')).toBe(
      'Social sign-in could not be completed. Please try again or use another sign-in method.',
    );
  });

  it('distinguishes provider configuration and denied consent', () => {
    expect(getOAuthErrorMessage('invalid_client')).toContain('provider is unavailable');
    expect(getOAuthErrorMessage('access_denied')).toContain('cancelled');
  });
});
