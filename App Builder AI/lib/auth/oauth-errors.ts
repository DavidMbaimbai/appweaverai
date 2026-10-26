export function getOAuthErrorMessage(error: string | null) {
  if (error === 'invalid_code') {
    // Better Auth also uses this code when the provider's token exchange
    // throws (including invalid_client). It does not establish link expiry.
    return 'Social sign-in could not be completed. Please try again. If it keeps failing, contact support or use another sign-in method.';
  }

  if (error === 'invalid_client' || error === 'oauth_provider_not_found') {
    return 'This social sign-in provider is unavailable. Please contact support or use another sign-in method.';
  }

  if (error === 'access_denied') {
    return 'Social sign-in was cancelled or access was denied. Please try again or use another sign-in method.';
  }

  if (['state_mismatch', 'state_not_found', 'state_expired'].includes(error ?? '')) {
    return 'Your social sign-in session could not be verified. Please start sign-in again.';
  }

  if (error === 'account_not_linked') {
    return 'This sign-in method is not linked to your AppWeaver account yet. Sign in with your existing method, then try Google again.';
  }

  return 'Social sign-in could not be completed. Please try again or use another sign-in method.';
}
