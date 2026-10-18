'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

const COOKIE_NAME = 'aw_cookie_consent';

export type CookieConsent = 'all' | 'essential';

export function readCookieConsent(): CookieConsent | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${COOKIE_NAME}=`));
  const value = match?.split('=')[1];
  return value === 'all' || value === 'essential' ? value : null;
}

function writeCookieConsent(value: CookieConsent) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${value}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event('aw-cookie-consent'));
}

function subscribe(callback: () => void) {
  window.addEventListener('aw-cookie-consent', callback);
  return () => window.removeEventListener('aw-cookie-consent', callback);
}

export function CookieBanner() {
  const consent = useSyncExternalStore(
    subscribe,
    () => readCookieConsent() ?? 'unset',
    () => 'pending',
  );

  if (consent !== 'unset') return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-xl rounded-xl border border-app-border bg-app-bg p-4 shadow-xl">
      <p className="text-sm text-app-text-secondary">
        We use essential cookies to keep you signed in and secure. With your
        permission we also use optional cookies to improve the product. See our{' '}
        <Link href="/cookies" className="underline">
          Cookie Policy
        </Link>
        .
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-text-secondary hover:border-appweaver-orange/50"
          onClick={() => writeCookieConsent('essential')}>
          Essential only
        </button>
        <button
          type="button"
          className="rounded-md bg-appweaver-orange px-3 py-1.5 text-sm font-medium text-white"
          onClick={() => writeCookieConsent('all')}>
          Accept all
        </button>
      </div>
    </div>
  );
}
