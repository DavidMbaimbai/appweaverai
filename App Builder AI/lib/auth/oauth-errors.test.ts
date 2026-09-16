import { describe, expect, it } from 'vitest';
import { getOAuthErrorMessage } from './oauth-errors';

describe('OAuth error messages', () => {
  it('shows a useful error for OAuth account-linking failures', () => {
    expect(getOAuthErrorMessage('account_not_linked')).toContain(
      'not linked to your AppWeaver account',
    );
  });

  it('preserves the invalid-code recovery message', () => {
    expect(getOAuthErrorMessage('invalid_code')).toContain('expired');
  });

  it('falls back to a generic useful sign-in error', () => {
    expect(getOAuthErrorMessage('some_provider_error')).toBe(
      'Sign-in could not be completed. Please try again.',
    );
  });
});
