import { describe, expect, it } from 'vitest';
import { getPasswordErrorMessage } from './password-errors';
import { clearSignInErrorUrl } from './clear-sign-in-error';

describe('sign-in error isolation', () => {
  it('reports credential rejection without asserting which account providers exist', () => {
    expect(getPasswordErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toContain('Invalid email or password. If');
  });
  it('does not describe unknown password failures as invalid credentials or expired links', () => {
    expect(getPasswordErrorMessage({ status: 500 })).toContain('Password sign-in could not be completed');
    expect(getPasswordErrorMessage({ code: 'invalid_code' })).not.toContain('expired');
  });
  it('distinguishes verification, rate limiting and CAPTCHA failures', () => {
    expect(getPasswordErrorMessage({ code: 'EMAIL_NOT_VERIFIED' })).toContain('verify your email');
    expect(getPasswordErrorMessage({ status: 429 })).toContain('wait a minute');
    expect(getPasswordErrorMessage({ code: 'MISSING_RESPONSE' })).toContain('security check');
  });
  it('clears stale OAuth state while preserving callback, other query parameters and hash', () => {
    const url = new URL('https://appweaverai.com/?auth=login&callbackUrl=%2Fapp&campaign=test&error=invalid_code&error_description=test&code=test&state=test&token=test#section');
    expect(clearSignInErrorUrl(url)).toBe('/?auth=login&callbackUrl=%2Fapp&campaign=test#section');
    expect(url.searchParams.get('error')).toBe('invalid_code');
  });
});
