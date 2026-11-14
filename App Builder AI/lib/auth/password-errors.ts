export function getPasswordErrorMessage(error: { code?: string; status?: number }) {
  if (error.code === 'INVALID_EMAIL_OR_PASSWORD') {
    return 'Invalid email or password. If you signed up with Google, try Continue with Google.';
  }
  if (error.code === 'EMAIL_NOT_VERIFIED') {
    return 'Please verify your email before signing in.';
  }
  if (error.status === 429) {
    return 'Too many sign-in attempts. Please wait a minute and try again.';
  }
  if (['MISSING_RESPONSE', 'CAPTCHA_VERIFICATION_FAILED', 'VERIFICATION_FAILED'].includes(error.code ?? '')) {
    return 'Please complete the security check and try again.';
  }
  return 'Password sign-in could not be completed. Please try again. If it keeps failing, contact support.';
}
