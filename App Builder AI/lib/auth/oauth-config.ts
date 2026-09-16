import type { BetterAuthOptions } from 'better-auth';
import type { OAuthProvider } from '@/lib/types/account';

type OAuthEnv = Record<string, string | undefined>;

type AccountLinkingConfig = NonNullable<
  NonNullable<BetterAuthOptions['account']>['accountLinking']
>;

export const accountLinkingConfig: AccountLinkingConfig = {
  enabled: true,
  disableImplicitLinking: false,
  requireLocalEmailVerified: false,
  trustedProviders: [],
  allowDifferentEmails: false,
  updateUserInfoOnLink: true,
};

function hasCredentials(clientId?: string, clientSecret?: string) {
  return Boolean(clientId?.trim() && clientSecret?.trim());
}

export function getEnabledOAuthProviders(env: OAuthEnv): OAuthProvider[] {
  const providers: OAuthProvider[] = [];

  if (hasCredentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)) {
    providers.push('google');
  }

  if (hasCredentials(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET)) {
    providers.push('github');
  }

  return providers;
}

export function getSocialProviders(
  env: OAuthEnv,
): NonNullable<BetterAuthOptions['socialProviders']> {
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};

  if (hasCredentials(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
    };
  }

  if (hasCredentials(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET)) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID!,
      clientSecret: env.GITHUB_CLIENT_SECRET!,
    };
  }

  return socialProviders;
}

export function canImplicitlyLinkOAuthAccount({
  providerEmailVerified,
  localEmailVerified,
  providerId,
}: {
  providerEmailVerified: boolean;
  localEmailVerified: boolean;
  providerId: string;
}) {
  const trustedProviders =
    Array.isArray(accountLinkingConfig.trustedProviders)
      ? accountLinkingConfig.trustedProviders
      : [];
  const isTrustedProvider = trustedProviders.includes(providerId);
  const requireLocalEmailVerified =
    accountLinkingConfig.requireLocalEmailVerified ?? true;

  return !(
    (!isTrustedProvider && !providerEmailVerified) ||
    (requireLocalEmailVerified && !localEmailVerified) ||
    accountLinkingConfig.enabled === false ||
    accountLinkingConfig.disableImplicitLinking === true
  );
}
