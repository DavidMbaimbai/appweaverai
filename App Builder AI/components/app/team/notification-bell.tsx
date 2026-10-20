'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { loadNotificationsAction, markNotificationsReadAction, setNotificationPreferenceAction } from '@/lib/team/actions';
import { NOTIFICATION_KINDS, NOTIFICATION_LABELS } from '@/lib/team/notification-kinds';

type Item = { id: string; kind: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string };

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const r = await loadNotificationsAction();
    setItems(r.items as Item[]);
    setUnread(r.unread);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  return (
    <div className="relative inline-block text-sm">
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        className="relative rounded border border-app-border px-2 py-1"
        onClick={() => setOpen((o) => !o)}
      >
        🔔{unread ? <span className="ml-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{unread}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-1 w-80 space-y-2 rounded-lg border border-app-border bg-app-bg p-2 shadow-lg">
          <div className="flex justify-between">
            <strong>Notifications</strong>
            {unread ? <button type="button" onClick={async () => { await markNotificationsReadAction(); await load(); }}>Mark all read</button> : null}
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {items.length === 0 ? <li className="text-app-text-muted">Nothing yet.</li> : null}
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? 'opacity-70' : 'font-medium'}>
                {n.href ? <Link href={n.href} onClick={() => void markNotificationsReadAction([n.id])}>{n.title}</Link> : n.title}
                {n.body ? <p className="text-xs font-normal text-app-text-muted">{n.body}</p> : null}
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer text-app-text-muted">Preferences</summary>
            <ul className="mt-1 space-y-1">
              {NOTIFICATION_KINDS.map((k) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span>{NOTIFICATION_LABELS[k]}</span>
                  <span className="flex gap-2">
                    <label><input type="checkbox" defaultChecked onChange={(e) => void setNotificationPreferenceAction(k, { inApp: e.target.checked, email: true })} /> In-app</label>
                    <label><input type="checkbox" defaultChecked onChange={(e) => void setNotificationPreferenceAction(k, { inApp: true, email: e.target.checked })} /> Email</label>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </div>
  );
}
