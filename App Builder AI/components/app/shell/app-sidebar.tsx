'use client';

import { AppWeaverLogo } from '@/components/ui/appweaver-logo';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import type { AppWorkspace } from '@/lib/app-types';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { WorkspaceSelector } from './workspace-selector';
import {
  AccountIcon,
  BillingIcon,
  SettingsIcon,
  TrashIcon,
} from './user-area-icons';

type AppSidebarProps = {
  workspaces: AppWorkspace[];
  activeWorkspaceSlug?: string;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  billing?: {
    creditBalance: number;
    plan: string;
    daysUntilRenewal: number | null;
  } | null;
  onOpenSearch: () => void;
};

const mainNav: Array<{
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}> = [
  { label: 'Home', href: '/app', icon: HomeIcon, exact: true },
  { label: 'Projects', href: '/app/projects', icon: ProjectsIcon, exact: true },
];

const secondaryNav: Array<{
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { label: 'Account', href: '/app/account', icon: AccountIcon },
  { label: 'Settings', href: '/app/settings', icon: SettingsIcon },
  { label: 'Billing', href: '/app/billing', icon: BillingIcon },
  { label: 'Trash', href: '/app/trash', icon: TrashIcon },
];

export function AppSidebar({
  workspaces,
  activeWorkspaceSlug,
  user,
  billing,
  onOpenSearch,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-app-sidebar shrink-0 flex-col border-r border-app-border-subtle bg-app-sidebar-bg">
      <div className="flex items-center justify-between px-3 py-3">
        <Link href="/app" aria-label="AppWeaver AI Home">
          <AppWeaverLogo size="compact" className="text-app-text" />
        </Link>
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text"
          aria-label="Search">
          <SearchIcon />
        </button>
      </div>

      <div className="px-3 pb-2">
        <WorkspaceSelector
          workspaces={workspaces}
          activeWorkspaceSlug={activeWorkspaceSlug}
          user={user}
        />
      </div>

      <div className="px-3 pb-3">
        <Link
          href="/app"
          className="group relative flex h-9 items-center gap-2 overflow-hidden rounded-lg px-3 text-sm font-medium text-white shadow-[0_2px_14px_rgba(61,111,212,0.22)] transition-[box-shadow,filter] hover:shadow-[0_4px_22px_rgba(61,111,212,0.32)] hover:brightness-105">
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-[#3730a3] via-app-accent-blue to-[#67b8f7]"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-tr from-white/20 via-transparent to-cyan-100/10 opacity-50 transition-opacity group-hover:opacity-80"
          />
          <SparklesIcon className="relative z-10 shrink-0" />
          <span className="relative z-10">Create something new</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-2">
        {mainNav.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);

          return (
            <Link
              href={item.href}
              key={item.label}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-app-surface-active text-app-text'
                  : 'text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
              )}>
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}

        <div className="my-2 border-t border-app-border-subtle" />

        {secondaryNav.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const badge =
            item.href === '/app/billing' && billing
              ? billingBadgeLabel(billing)
              : null;

          return (
            <Link
              href={item.href}
              key={item.label}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-app-surface-active text-app-text'
                  : 'text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
              )}>
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {badge ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
                    badge.urgent
                      ? 'bg-red-500/15 text-red-400'
                      : 'bg-app-surface-active text-app-text-muted',
                  )}>
                  {badge.text}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-app-border-subtle px-3 py-3">
        <Link
          href="/app/account"
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-app-surface-hover">
          {/* Avatar */}
          <Avatar
            size="sm"
            theme="app"
            name={user.name ?? user.email}
            image={user.image}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-app-text">
              {user.name ?? 'Account'}
            </p>
            <p className="truncate text-xs text-app-text-muted">
              {user.email ?? ''}
            </p>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => {
            void authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = '/';
                },
              },
            });
          }}
          className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-appweaver-orange transition-colors hover:bg-appweaver-orange/10">
          <SignOutIcon className="h-3.5 w-3.5 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

function billingBadgeLabel(billing: {
  creditBalance: number;
  plan: string;
  daysUntilRenewal: number | null;
}): { text: string; urgent: boolean } | null {
  // Prioritize the more urgent/actionable signal: depleted/low credits over
  // an upcoming renewal reminder.
  if (billing.creditBalance <= 0) {
    return { text: '0 credits', urgent: true };
  }
  if (billing.creditBalance <= 20) {
    return { text: `${billing.creditBalance} left`, urgent: true };
  }
  if (billing.daysUntilRenewal != null && billing.daysUntilRenewal <= 3) {
    return {
      text: `${billing.daysUntilRenewal}d left`,
      urgent: billing.daysUntilRenewal <= 1,
    };
  }
  return { text: `${billing.creditBalance} credits`, urgent: false };
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

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M16 16l5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}>
      <path
        d="M12 2.5 13.4 7.6 18.5 9 13.4 10.4 12 15.5 10.6 10.4 5.5 9 10.6 7.6 12 2.5Z"
        fill="currentColor"
      />
      <path
        d="M19.2 13.8 20 16.2 22.4 17 20 17.8 19.2 20.2 18.4 17.8 16 17 18.4 16.2 19.2 13.8Z"
        fill="currentColor"
        opacity="0.85"
      />
      <path
        d="M5.2 15.8 5.8 17.6 7.6 18.2 5.8 18.8 5.2 20.6 4.6 18.8 2.8 18.2 4.6 17.6 5.2 15.8Z"
        fill="currentColor"
        opacity="0.75"
      />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19v-8.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 20.5V14a2.5 2.5 0 0 1 5 0v6.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ProjectsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <rect
        x="4"
        y="4"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="13"
        y="4"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="4"
        y="13"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="13"
        y="13"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

