'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { AdminNavItem } from './admin-shell';

export function AdminNavLinks({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        const isActive =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'block rounded-lg px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-app-surface-active text-app-text'
                : 'text-app-text-secondary hover:bg-app-surface-hover hover:text-app-text',
            )}>
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
