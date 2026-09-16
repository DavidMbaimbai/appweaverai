export function getOAuthErrorMessage(error: string | null) {
  if (error === 'invalid_code') {
    return 'That sign-in link expired or was already used. Please try signing in again.';
  }

  if (error === 'account_not_linked') {
    return 'This sign-in method is not linked to your AppWeaver account yet. Sign in with your existing method, then try Google again.';
  }

  return 'Sign-in could not be completed. Please try again.';
}
