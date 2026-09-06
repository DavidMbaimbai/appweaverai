'use client';

import { Avatar } from '@/components/ui/avatar';
import { authClient } from '@/lib/auth-client';
import Link from 'next/link';
import {
  AccountIcon,
  BillingIcon,
  SettingsIcon,
  TrashIcon,
} from './user-area-icons';
import { cn } from '@/lib/utils';

type AccountMenuPanelProps = {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  onClose: () => void;
  className?: string;
};

const menuItems = [
  { label: 'Account', href: '/app/account', icon: AccountIcon },
  { label: 'Settings', href: '/app/settings', icon: SettingsIcon },
  { label: 'Billing', href: '/app/billing', icon: BillingIcon },
  { label: 'Trash', href: '/app/trash', icon: TrashIcon },
];

export function AccountMenuPanel({
  user,
  onClose,
  className,
}: AccountMenuPanelProps) {
  return (
    <div
      role="menu"
      aria-label="Account menu"
      className={cn(
        'w-full min-w-0 overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-[0_16px_48px_rgba(0,0,0,0.4)]',
        className,
      )}>
      <div className="flex items-center gap-2 border-b border-app-border-subtle px-2.5 py-2">
        <Avatar
          name={user.name ?? user.email}
          image={user.image}
          size="sm"
          theme="app"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-app-text">
            {user.name ?? 'Account'}
          </p>
          {user.email ? (
            <p className="truncate text-xs text-app-text-muted">{user.email}</p>
          ) : null}
        </div>
      </div>

      <ul className="p-1.5">
        {menuItems.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              role="menuitem"
              onClick={onClose}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-app-text-secondary transition-colors',
                'hover:bg-app-surface-hover hover:text-app-text',
              )}>
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="border-t border-app-border-subtle p-1.5">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            void authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = '/';
                },
              },
            });
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-replit-orange transition-colors hover:bg-replit-orange/10">
          <SignOutIcon className="h-3.5 w-3.5 shrink-0" />
          Sign out
        </button>
      </div>
    </div>
  );
}

function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M10 7V6a2 2 0 0 1 2-2h7v16h-7a2 2 0 0 1-2-2v-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M14 12H4m0 0 3-3M4 12l3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
