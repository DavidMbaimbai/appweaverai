'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

function consent() {
  return document.cookie.split(';').some((c) => c.trim() === 'aw_cookie_consent=all');
}

/** Sends one first-party visit beacon per tab session, only with analytics consent and without DNT/GPC. */
export function GrowthTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const send = () => {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (!consent() || navigator.doNotTrack === '1' || nav.globalPrivacyControl) return;
      if (pathname.startsWith('/admin') || pathname.startsWith('/api')) return;
      if (sessionStorage.getItem('aw_gv_sent')) return;
      sessionStorage.setItem('aw_gv_sent', '1');
      void fetch('/api/growth/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: pathname, search: window.location.search, referrer: document.referrer }),
        keepalive: true,
      }).catch(() => undefined);
    };
    send();
    window.addEventListener('aw-cookie-consent', send);
    return () => window.removeEventListener('aw-cookie-consent', send);
  }, [pathname]);
  return null;
}
