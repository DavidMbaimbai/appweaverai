'use client';

import { authClient } from '@/lib/auth-client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AuthMode, OAuthProvider } from '@/lib/types/account';
import { cn } from '@/lib/utils';
import { CloseIcon, EyeIcon, EyeOffIcon } from './auth-icons';
import { useAuthModal } from './auth-modal-provider';
import { OAuthButton } from './oauth-button';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppWeaverLogo } from '../ui/appweaver-logo';
import {
  recordEmailVerifiedAction,
  resolvePasswordResetReminderAction,
} from '@/lib/auth/actions';
import { useAuthSession } from './session-provider';

const DEFAULT_CALLBACK_URL = '/app';
const AUTH_QUERY_KEYS = [
  'auth',
  'error',
  'callbackUrl',
  'callbackurl',
  'callbackURL',
  'code',
  'state',
  'token',
] as const;

const modeCopy: Record<
  AuthMode,
  {
    title: string;
    subtitle: string;
    submit: string;
    switchPrompt: string;
    switchAction: string;
  }
> = {
  login: {
    title: 'Welcome back',
    subtitle: 'Log in to continue building on AppWeaver AI.',
    submit: 'Log in',
    switchPrompt: "Don't have an account?",
    switchAction: 'Create account',
  },
  register: {
    title: 'Create your account',
    subtitle: 'Start building apps with AppWeaver AI agent in minutes',
    submit: 'Create account',
    switchPrompt: 'Already have an account?',
    switchAction: 'Log in',
  },
};

function AuthDivider() {
  return (
    <div className="relative py-1">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border-light" />
      <p className="relative mx-auto w-fit bg-surface-white px-3 text-xs text-text-muted">
        or continue with email
      </p>
    </div>
  );
}

type AuthFieldProps = {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

function AuthField({
  id,
  label,
  type,
  autoComplete,
  placeholder,
  value,
  onChange,
}: AuthFieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-text-secondary">
        {label}
      </label>
      <input
        type={type}
        id={id}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 text-sm text-text-primary placeholder:text-text-muted',
          'transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20',
        )}
      />
    </div>
  );
}

export function AuthModal() {
  const router = useRouter();
  const { refetch: refetchSession } = useAuthSession();
  const {
    isOpen,
    mode,
    initialError,
    enabledOAuthProviders,
    closeAuthModal,
    setAuthMode,
  } = useAuthModal();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once set, the modal shows the "enter your 8-digit code" step instead of
  // the login/register form (see handleSubmit's register branch below).
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<
    string | null
  >(null);
  const [otp, setOtp] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  // Shows a branded "thank you" confirmation once the code is accepted,
  // right before redirecting into the app.
  const [verificationSuccess, setVerificationSuccess] = useState(false);

  // Forgot-password flow: showForgotPassword displays the "enter your
  // email" step; once a code has been requested, pendingResetEmail
  // switches to the "enter code + new password" step (mirrors the
  // sign-up email verification flow above).
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [pendingResetEmail, setPendingResetEmail] = useState<string | null>(
    null,
  );
  const [resetOtp, setResetOtp] = useState('');
  const [resetOtpVerified, setResetOtpVerified] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const copy = modeCopy[mode];
  const alternateMode: AuthMode = mode === 'login' ? 'register' : 'login';
  const callbackUrl =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('callbackUrl') ??
        new URLSearchParams(window.location.search).get('callbackurl') ??
        new URLSearchParams(window.location.search).get('callbackURL'))
      : null;
  const redirectHint =
    callbackUrl === '/app'
      ? 'Sign in to open your workspace'
      : callbackUrl?.startsWith('/')
        ? 'Sign in to continue'
        : null;

  const cleanAuthQuery = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const hasAuthQuery = AUTH_QUERY_KEYS.some((key) => params.has(key));

    if (!hasAuthQuery) {
      return;
    }

    for (const key of AUTH_QUERY_KEYS) {
      params.delete(key);
    }

    const query = params.toString();
    const cleanUrl = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;

    window.history.replaceState(null, '', cleanUrl);
    router.replace(cleanUrl);
  }, [router]);

  const completeAuthSuccess = useCallback(
    (target: string) => {
      setError(null);
      closeAuthModal();
      cleanAuthQuery();
      void refetchSession();
      router.replace(target);
      router.refresh();
    },
    [cleanAuthQuery, closeAuthModal, refetchSession, router],
  );

  const handleClose = useCallback(() => {
    closeAuthModal();
    cleanAuthQuery();
  }, [cleanAuthQuery, closeAuthModal]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (!isOpen) return;

    const reset = () => {
      setName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setError(initialError);
      setIsLoading(false);
      setPendingVerificationEmail(null);
      setOtp('');
      setIsResending(false);
      setResendMessage(null);
      setVerificationSuccess(false);
      setShowForgotPassword(false);
      setForgotPasswordEmail('');
      setPendingResetEmail(null);
      setResetOtp('');
      setResetOtpVerified(false);
      setNewPassword('');
      setConfirmNewPassword('');
      setShowNewPassword(false);
    };

    reset();
  }, [initialError, isOpen]);

  function getCallbackUrl() {
    const params = new URLSearchParams(window.location.search);
    const callback =
      params.get('callbackUrl') ??
      params.get('callbackurl') ??
      params.get('callbackURL');

    if (callback?.startsWith('/') && !callback.startsWith('//')) {
      return callback;
    }
    return DEFAULT_CALLBACK_URL;
  }

  function handleOAuthClick(provider: OAuthProvider) {
    setError(null);
    setIsLoading(true);
    void authClient.signIn.social({
      provider,
      callbackURL: getCallbackUrl(),
      fetchOptions: {
        onError: (ctx) => {
          setIsLoading(false);
          setError(ctx.error.message ?? 'sign-in failed. Please try again');
        },
      },
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    if (mode === 'register') {
      void authClient.signUp.email({
        name,
        email,
        password,
        callbackURL: getCallbackUrl(),
        fetchOptions: {
          onSuccess: () => {
            setIsLoading(false);
            setPendingVerificationEmail(email);
          },
          onError: (ctx) => {
            setIsLoading(false);
            setError(ctx.error.message ?? 'Could not create your account.');
          },
        },
      });
      return;
    }

    void authClient.signIn.email({
      email,
      password,
      callbackURL: getCallbackUrl(),
      fetchOptions: {
        onSuccess: () => {
          completeAuthSuccess(getCallbackUrl());
        },
        onError: (ctx) => {
          setIsLoading(false);
          setError(ctx.error.message ?? 'Invalid email or password.');
        },
      },
    });
  }

  function handleVerifyOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingVerificationEmail) return;

    setError(null);
    setIsLoading(true);

    void authClient.emailOtp.verifyEmail({
      email: pendingVerificationEmail,
      otp,
      fetchOptions: {
        onSuccess: () => {
          setIsLoading(false);
          setVerificationSuccess(true);

          // Best-effort: record where this verification happened (for the
          // Admin Console's Audit Logs / Security Events and the public
          // "recent verifications" map). Never blocks the redirect.
          void recordEmailVerifiedAction();

          const target = getCallbackUrl();
          window.setTimeout(() => {
            completeAuthSuccess(target);
          }, 2200);
        },
        onError: (ctx) => {
          setIsLoading(false);
          setError(ctx.error.message ?? 'Invalid or expired code.');
        },
      },
    });
  }

  function handleResendOtp() {
    if (!pendingVerificationEmail) return;

    setError(null);
    setResendMessage(null);
    setIsResending(true);

    void authClient.emailOtp.sendVerificationOtp({
      email: pendingVerificationEmail,
      type: 'email-verification',
      fetchOptions: {
        onSuccess: () => {
          setIsResending(false);
          setResendMessage('A new code has been sent to your email.');
        },
        onError: (ctx) => {
          setIsResending(false);
          setError(ctx.error.message ?? 'Could not resend the code.');
        },
      },
    });
  }

  function handleRequestPasswordReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!forgotPasswordEmail.trim()) {
      setError('Enter your email address first.');
      return;
    }

    setIsLoading(true);

    void authClient.emailOtp.requestPasswordReset({
      email: forgotPasswordEmail.trim(),
      fetchOptions: {
        onSuccess: () => {
          setIsLoading(false);
          setPendingResetEmail(forgotPasswordEmail.trim());
        },
        onError: (ctx) => {
          setIsLoading(false);
          setError(ctx.error.message ?? 'Could not send a reset code.');
        },
      },
    });
  }

  function handleResendResetOtp() {
    if (!pendingResetEmail) return;

    setError(null);
    setResendMessage(null);
    setIsResending(true);

    void authClient.emailOtp.requestPasswordReset({
      email: pendingResetEmail,
      fetchOptions: {
        onSuccess: () => {
          setIsResending(false);
          setResetOtpVerified(false);
          setResetOtp('');
          setResendMessage('A new code has been sent to your email.');
        },
        onError: (ctx) => {
          setIsResending(false);
          setError(ctx.error.message ?? 'Could not resend the code.');
        },
      },
    });
  }

  // Step 1 of the reset flow (after a code is requested): verify the code on
  // its own before asking for a new password, so the two steps stay separate
  // instead of one combined form.
  function handleVerifyResetOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingResetEmail) return;

    setError(null);
    setIsLoading(true);

    void authClient.emailOtp.checkVerificationOtp({
      email: pendingResetEmail,
      type: 'forget-password',
      otp: resetOtp,
      fetchOptions: {
        onSuccess: () => {
          setIsLoading(false);
          setResetOtpVerified(true);
        },
        onError: (ctx) => {
          setIsLoading(false);
          setError(ctx.error.message ?? 'Invalid or expired code.');
        },
      },
    });
  }

  // Step 2 of the reset flow: the code was already verified above, so this
  // only needs to submit the new password.
  function handleResetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingResetEmail) return;

    setError(null);

    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    void authClient.emailOtp.resetPassword({
      email: pendingResetEmail,
      otp: resetOtp,
      password: newPassword,
      fetchOptions: {
        onSuccess: () => {
          // The reset succeeded — cancel any pending "still having trouble
          // signing in?" reminder email for this address.
          void resolvePasswordResetReminderAction(pendingResetEmail);

          // Automatically sign the user in with their new password rather
          // than bouncing them back to a plain login form.
          void authClient.signIn.email({
            email: pendingResetEmail,
            password: newPassword,
            callbackURL: getCallbackUrl(),
            fetchOptions: {
              onSuccess: () => {
                completeAuthSuccess(getCallbackUrl());
              },
              onError: () => {
                setIsLoading(false);
                setShowForgotPassword(false);
                setPendingResetEmail(null);
                setAuthMode('login');
                setResendMessage(
                  'Your password was reset. Please log in with your new password.',
                );
              },
            },
          });
        },
        onError: (ctx) => {
          setIsLoading(false);
          setError(ctx.error.message ?? 'Invalid or expired code.');
        },
      },
    });
  }

  if (!isOpen) return null;

  if (verificationSuccess) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[#191818]/45 backdrop-blur-[2px]" />

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Account verified"
          className="relative w-full max-w-auth-modal overflow-hidden rounded-[24px] border border-[#e3e2dd] bg-surface-white p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.18)] auth-modal-panel">
          <div className="mx-auto flex justify-center">
            <AppWeaverLogo />
          </div>

          <div className="mx-auto mt-6 flex h-16 w-16 items-center justify-center rounded-full bg-appweaver-orange/10">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-8 w-8 text-appweaver-orange"
              aria-hidden="true">
              <path
                d="M5 12.5L9.5 17L19 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h2 className="mt-5 font-display text-[26px] font-normal leading-tight tracking-[-0.04em] text-text-agent-heading">
            You&apos;re all set{name ? `, ${name.split(' ')[0]}` : ''}!
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
            Thanks for verifying your email — your AppWeaver AI account is
            ready. Taking you to your dashboard now&hellip;
          </p>

          <div className="mx-auto mt-6 h-1 w-40 overflow-hidden rounded-full bg-pricing-surface">
            <div className="h-full w-full origin-left animate-auth-success-progress rounded-full bg-appweaver-orange" />
          </div>
        </div>
      </div>
    );
  }

  if (pendingResetEmail && !resetOtpVerified) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close authentication modal"
          className="absolute inset-0 bg-[#191818]/45 backdrop-blur-[2px]"
          onClick={handleClose}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="relative max-h-auth-modal w-full max-w-auth-modal overflow-y-auto rounded-[24px] border border-[#e3e2dd] bg-surface-white shadow-[0_24px_80px_rgba(0,0,0,0.18)] auth-modal-panel">
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 pb-5 pt-6">
            <div>
              <div className="mb-3">
                <AppWeaverLogo size="compact" />
              </div>
              <h2
                id={titleId}
                className="font-display text-[28px] font-normal leading-tight tracking-[-0.04em] text-text-agent-heading">
                Enter your code
              </h2>
              <p
                id={descriptionId}
                className="mt-1.5 text-sm leading-relaxed text-text-muted">
                Enter the 8-digit code we sent to{' '}
                <span className="font-medium text-text-secondary">
                  {pendingResetEmail}
                </span>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-pricing-surface hover:text-text-secondary">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="px-6 py-5">
            {error && (
              <p className="mb-3 rounded-xl bg-appweaver-orange/10 px-3 py-2 text-sm text-appweaver-orange">
                {error}
              </p>
            )}
            {resendMessage && (
              <p className="mb-3 rounded-xl bg-pricing-surface px-3 py-2 text-sm text-text-secondary">
                {resendMessage}
              </p>
            )}

            <form className="space-y-4" onSubmit={handleVerifyResetOtp}>
              <div className="space-y-1.5">
                <label
                  htmlFor="reset-otp"
                  className="block text-sm font-medium text-text-secondary">
                  Verification code
                </label>
                <input
                  id="reset-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="12345678"
                  value={resetOtp}
                  onChange={(event) =>
                    setResetOtp(
                      event.target.value.replace(/\D/g, '').slice(0, 8),
                    )
                  }
                  className="h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 text-center text-lg tracking-[0.3em] text-text-primary placeholder:text-text-muted transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || resetOtp.length !== 8}
                className="h-11 w-full rounded-full bg-appweaver-orange text-sm font-medium text-white transition-colors hover:bg-[#e03600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appweaver-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                Continue
              </button>
            </form>
          </div>

          <div className="border-t border-black/[0.06] px-6 py-4 text-center text-sm text-text-muted">
            Didn&apos;t get a code?{' '}
            <button
              type="button"
              disabled={isResending}
              onClick={handleResendResetOtp}
              className="font-medium text-appweaver-orange transition-colors hover:text-[#e03600] disabled:opacity-60">
              Resend code
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pendingResetEmail && resetOtpVerified) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close authentication modal"
          className="absolute inset-0 bg-[#191818]/45 backdrop-blur-[2px]"
          onClick={handleClose}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="relative max-h-auth-modal w-full max-w-auth-modal overflow-y-auto rounded-[24px] border border-[#e3e2dd] bg-surface-white shadow-[0_24px_80px_rgba(0,0,0,0.18)] auth-modal-panel">
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 pb-5 pt-6">
            <div>
              <div className="mb-3">
                <AppWeaverLogo size="compact" />
              </div>
              <h2
                id={titleId}
                className="font-display text-[28px] font-normal leading-tight tracking-[-0.04em] text-text-agent-heading">
                Choose a new password
              </h2>
              <p
                id={descriptionId}
                className="mt-1.5 text-sm leading-relaxed text-text-muted">
                Code verified. Now set a new password for{' '}
                <span className="font-medium text-text-secondary">
                  {pendingResetEmail}
                </span>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-pricing-surface hover:text-text-secondary">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="px-6 py-5">
            {error && (
              <p className="mb-3 rounded-xl bg-appweaver-orange/10 px-3 py-2 text-sm text-appweaver-orange">
                {error}
              </p>
            )}

            <form className="space-y-4" onSubmit={handleResetPassword}>
              <div className="space-y-1.5">
                <label
                  htmlFor="reset-new-password"
                  className="block text-sm font-medium text-text-secondary">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="reset-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Create a new password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className={cn(
                      'h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 pr-11 text-sm text-text-primary placeholder:text-text-muted',
                      'transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((value) => !value)}
                    aria-label={
                      showNewPassword ? 'Hide password' : 'Show password'
                    }
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-muted transition-colors hover:text-text-secondary">
                    {showNewPassword ? (
                      <EyeOffIcon className="h-5 w-5" />
                    ) : (
                      <EyeIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="reset-confirm-password"
                  className="block text-sm font-medium text-text-secondary">
                  Confirm new password
                </label>
                <input
                  id="reset-confirm-password"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Re-enter your new password"
                  value={confirmNewPassword}
                  onChange={(event) =>
                    setConfirmNewPassword(event.target.value)
                  }
                  className={cn(
                    'h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 text-sm text-text-primary placeholder:text-text-muted',
                    'transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20',
                  )}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || !newPassword}
                className="h-11 w-full rounded-full bg-appweaver-orange text-sm font-medium text-white transition-colors hover:bg-[#e03600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appweaver-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                Reset password
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (showForgotPassword) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close authentication modal"
          className="absolute inset-0 bg-[#191818]/45 backdrop-blur-[2px]"
          onClick={handleClose}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="relative max-h-auth-modal w-full max-w-auth-modal overflow-y-auto rounded-[24px] border border-[#e3e2dd] bg-surface-white shadow-[0_24px_80px_rgba(0,0,0,0.18)] auth-modal-panel">
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 pb-5 pt-6">
            <div>
              <div className="mb-3">
                <AppWeaverLogo size="compact" />
              </div>
              <h2
                id={titleId}
                className="font-display text-[28px] font-normal leading-tight tracking-[-0.04em] text-text-agent-heading">
                Reset your password
              </h2>
              <p
                id={descriptionId}
                className="mt-1.5 text-sm leading-relaxed text-text-muted">
                Enter your account email and we&apos;ll send you an 8-digit
                code to reset your password.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-pricing-surface hover:text-text-secondary">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="px-6 py-5">
            {error && (
              <p className="mb-3 rounded-xl bg-appweaver-orange/10 px-3 py-2 text-sm text-appweaver-orange">
                {error}
              </p>
            )}

            <form
              className="space-y-4"
              onSubmit={handleRequestPasswordReset}>
              <AuthField
                id="forgot-password-email"
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={forgotPasswordEmail}
                onChange={setForgotPasswordEmail}
              />

              <button
                type="submit"
                disabled={isLoading}
                className="h-11 w-full rounded-full bg-appweaver-orange text-sm font-medium text-white transition-colors hover:bg-[#e03600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appweaver-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                Send reset code
              </button>
            </form>
          </div>

          <div className="border-t border-black/[0.06] px-6 py-4 text-center text-sm text-text-muted">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setShowForgotPassword(false);
              }}
              className="font-medium text-appweaver-orange transition-colors hover:text-[#e03600]">
              Back to log in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pendingVerificationEmail) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close authentication modal"
          className="absolute inset-0 bg-[#191818]/45 backdrop-blur-[2px]"
          onClick={handleClose}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="relative max-h-auth-modal w-full max-w-auth-modal overflow-y-auto rounded-[24px] border border-[#e3e2dd] bg-surface-white shadow-[0_24px_80px_rgba(0,0,0,0.18)] auth-modal-panel">
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 pb-5 pt-6">
            <div>
              <div className="mb-3">
                <AppWeaverLogo size="compact" />
              </div>
              <h2
                id={titleId}
                className="font-display text-[28px] font-normal leading-tight tracking-[-0.04em] text-text-agent-heading">
                Verify your email
              </h2>
              <p
                id={descriptionId}
                className="mt-1.5 text-sm leading-relaxed text-text-muted">
                Enter the 8-digit code we sent to{' '}
                <span className="font-medium text-text-secondary">
                  {pendingVerificationEmail}
                </span>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-pricing-surface hover:text-text-secondary">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="px-6 py-5">
            {error && (
              <p className="mb-3 rounded-xl bg-appweaver-orange/10 px-3 py-2 text-sm text-appweaver-orange">
                {error}
              </p>
            )}
            {resendMessage && (
              <p className="mb-3 rounded-xl bg-pricing-surface px-3 py-2 text-sm text-text-secondary">
                {resendMessage}
              </p>
            )}

            <form className="space-y-4" onSubmit={handleVerifyOtp}>
              <div className="space-y-1.5">
                <label
                  htmlFor="auth-otp"
                  className="block text-sm font-medium text-text-secondary">
                  Verification code
                </label>
                <input
                  id="auth-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="12345678"
                  value={otp}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D/g, '').slice(0, 8))
                  }
                  className="h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 text-center text-lg tracking-[0.3em] text-text-primary placeholder:text-text-muted transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || otp.length !== 8}
                className="h-11 w-full rounded-full bg-appweaver-orange text-sm font-medium text-white transition-colors hover:bg-[#e03600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appweaver-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                Verify email
              </button>
            </form>
          </div>

          <div className="border-t border-black/[0.06] px-6 py-4 text-center text-sm text-text-muted">
            Didn&apos;t get a code?{' '}
            <button
              type="button"
              disabled={isResending}
              onClick={handleResendOtp}
              className="font-medium text-appweaver-orange transition-colors hover:text-[#e03600] disabled:opacity-60">
              Resend code
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close authentication modal"
        className="absolute inset-0 bg-[#191818]/45 backdrop-blur-[2px]"
        onClick={handleClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative max-h-auth-modal w-full max-w-auth-modal overflow-y-auto rounded-[24px] border border-[#e3e2dd] bg-surface-white shadow-[0_24px_80px_rgba(0,0,0,0.18)] auth-modal-panel">
        <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 pb-5 pt-6">
          <div>
            <h2
              id={titleId}
              className="font-display text-[28px] font-normal leading-tight tracking-[-0.04em] text-text-agent-heading">
              {copy.title}
            </h2>
            <p
              id={descriptionId}
              className="mt-1.5 text-sm leading-relaxed text-text-muted">
              {redirectHint ?? copy.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-pricing-surface hover:text-text-secondary">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-pricing-surface p-1">
            {(['login', 'register'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={mode === tab}
                onClick={() => setAuthMode(tab)}
                className={cn(
                  'h-9 rounded-full text-sm font-medium transition-colors',
                  mode === tab
                    ? 'bg-surface-white text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary',
                )}>
                {tab === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {enabledOAuthProviders.map((provider) => (
              <OAuthButton
                key={provider}
                provider={provider}
                disabled={isLoading}
                onClick={() => handleOAuthClick(provider)}
              />
            ))}
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-appweaver-orange/10 px-3 py-2 text-sm text-appweaver-orange">
              {error}
            </p>
          )}

          <AuthDivider />

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <AuthField
                id="auth-name"
                label="Full name"
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={setName}
              />
            )}

            <AuthField
              id="auth-email"
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={setEmail}
            />

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="auth-password"
                  className="text-sm font-medium text-text-secondary">
                  Password
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setForgotPasswordEmail(email);
                      setShowForgotPassword(true);
                    }}
                    className="text-xs font-medium text-appweaver-orange transition-colors hover:text-[#e03600]">
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  placeholder={
                    mode === 'login'
                      ? 'Enter your password'
                      : 'Create a password'
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={cn(
                    'h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 pr-11 text-sm text-text-primary placeholder:text-text-muted',
                    'transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-muted transition-colors hover:text-text-secondary">
                  {showPassword ? (
                    <EyeOffIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="auth-confirm-password"
                  className="text-sm font-medium text-text-secondary">
                  Confirm password
                </label>
                <div className="relative">
                  <input
                    id="auth-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className={cn(
                      'h-11 w-full rounded-xl border border-border-light bg-surface-white px-3.5 pr-11 text-sm text-text-primary placeholder:text-text-muted',
                      'transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/20',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    aria-label={
                      showConfirmPassword ? 'Hide password' : 'Show password'
                    }
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-muted transition-colors hover:text-text-secondary">
                    {showConfirmPassword ? (
                      <EyeOffIcon className="h-5 w-5" />
                    ) : (
                      <EyeIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {mode === 'register' && (
              <p className="text-xs leading-relaxed text-text-muted">
                By creating an account, you agree to our{' '}
                <Link
                  href="/terms"
                  className="text-text-secondary underline underline-offset-2">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link
                  href="/privacy"
                  className="text-text-secondary underline underline-offset-2">
                  Privacy Policy
                </Link>
                .
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="h-11 w-full rounded-full bg-appweaver-orange text-sm font-medium text-white transition-colors hover:bg-[#e03600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appweaver-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
              {copy.submit}
            </button>
          </form>
        </div>

        <div className="border-t border-black/[0.06] px-6 py-4 text-center text-sm text-text-muted">
          {copy.switchPrompt}{' '}
          <button
            type="button"
            onClick={() => setAuthMode(alternateMode)}
            className="font-medium text-appweaver-orange transition-colors hover:text-[#e03600]">
            {copy.switchAction}
          </button>
        </div>
      </div>
    </div>
  );
}

