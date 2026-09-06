import type { ReactNode } from 'react';
import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Navbar } from '@/components/layout/navbar';
import { getCachedSession } from '@/lib/auth/cached';
import { DocsSidebar } from './docs-sidebar';

export async function DocsShell({
  activeSlug,
  children,
}: {
  activeSlug?: string;
  children: ReactNode;
}) {
  const session = await getCachedSession();
  const initialUser = session?.user
    ? { name: session.user.name, email: session.user.email }
    : null;

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[70vh] bg-[#faf9f8] py-10 tablet-up:py-14">
        <Container className="flex flex-col gap-10 desktop:flex-row">
          <DocsSidebar activeSlug={activeSlug} />
          <div className="min-w-0 flex-1">{children}</div>
        </Container>
      </main>
      <div className="border-t border-border-light/60 bg-[#faf9f8] py-6">
        <Container className="flex justify-center">
          <Link
            href="/"
            className="text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary">
            Back to home
          </Link>
        </Container>
      </div>
    </>
  );
}
