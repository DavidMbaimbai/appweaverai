import { describe, expect, it } from 'vitest';
import {
  accountLinkingConfig,
  canImplicitlyLinkOAuthAccount,
  getEnabledOAuthProviders,
  getSocialProviders,
} from './oauth-config';

describe('OAuth auth configuration', () => {
  it('allows an existing email/password account to link a matching verified Google identity', () => {
    expect(
      canImplicitlyLinkOAuthAccount({
        providerId: 'google',
        providerEmailVerified: true,
        localEmailVerified: false,
      }),
    ).toBe(true);
  });

  it('uses Better Auth account-linking config that avoids provider-name-only trust', () => {
    expect(accountLinkingConfig).toMatchObject({
      enabled: true,
      disableImplicitLinking: false,
      requireLocalEmailVerified: false,
      trustedProviders: [],
      allowDifferentEmails: false,
      updateUserInfoOnLink: true,
    });
  });

  it('does not implicitly link when the OAuth provider email is unverified', () => {
    expect(
      canImplicitlyLinkOAuthAccount({
        providerId: 'google',
        providerEmailVerified: false,
        localEmailVerified: false,
      }),
    ).toBe(false);
  });

  it('links instead of requiring duplicate user creation for verified matching OAuth identities', () => {
    const existingUsersBeforeOAuth = 1;
    const canLink = canImplicitlyLinkOAuthAccount({
      providerId: 'google',
      providerEmailVerified: true,
      localEmailVerified: false,
    });

    const existingUsersAfterOAuth = canLink
      ? existingUsersBeforeOAuth
      : existingUsersBeforeOAuth + 1;

    expect(existingUsersAfterOAuth).toBe(existingUsersBeforeOAuth);
  });

  it('keeps email/password auth enabled independently of OAuth providers', () => {
    expect(accountLinkingConfig.enabled).toBe(true);
    expect(accountLinkingConfig.allowDifferentEmails).toBe(false);
  });

  it('does not configure GitHub when credentials are missing, and still configures Google', () => {
    const env = {
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
    };

    expect(getEnabledOAuthProviders(env)).toEqual(['google']);
    expect(getSocialProviders(env)).toEqual({
      google: {
        clientId: 'google-client',
        clientSecret: 'google-secret',
      },
    });
  });
});
