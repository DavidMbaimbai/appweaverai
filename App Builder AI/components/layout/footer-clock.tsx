'use client';

import { useEffect, useState } from 'react';

function getLocationLabel(timeZone: string) {
  const city = timeZone.split('/').pop() ?? timeZone;
  return city.replace(/_/g, ' ');
}

/**
 * Live local clock that auto-detects the visitor's timezone/location from
 * their system (no permissions or geolocation API needed) and ticks every
 * second, similar to the footer widget on replit.com.
 */
export function FooterClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const location = getLocationLabel(timeZone);

  if (!now) {
    return (
      <div className="rounded-xl border border-border-light bg-surface-white px-3 py-2 text-sm">
        <span className="text-text-muted">Loading local time…</span>
      </div>
    );
  }

  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="rounded-xl border border-border-light bg-surface-white px-3 py-2 text-sm">
      <span className="font-medium">{location}</span>
      <span className="mx-1.5 text-text-muted">·</span>
      <span className="tabular-nums text-text-muted">{time}</span>
    </div>
  );
}
