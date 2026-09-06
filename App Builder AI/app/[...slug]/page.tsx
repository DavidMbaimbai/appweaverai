import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { getCachedSession } from '@/lib/auth/cached';

/**
 * Generic fallback for every marketing/navigation link (e.g. /roles/founders,
 * /use-cases/business, /docs, /community, ...) that doesn't have dedicated
 * content yet. These are public pages — no sign-in required — so visitors
 * can always click through from the nav/footer and see something real
 * instead of a 404 or a login wall.
 */

function humanize(slug: string) {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function MarketingFallbackPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const session = await getCachedSession();
  const initialUser = session?.user
    ? { name: session.user.name, email: session.user.email }
    : null;

  const section = humanize(slug[0] ?? '');
  const title = humanize(slug[slug.length - 1] ?? '');

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-replit-orange">
            {section}
          </p>
          <h1 className="font-display text-[40px] leading-none tracking-[-1.6px] text-text-agent-heading tablet-up:text-[56px]">
            {title}
          </h1>
          <p className="max-w-[560px] font-display text-lg leading-snug text-text-dim">
            This page is publicly viewable — no sign-in needed. We&apos;re still
            building out the full content for {title}, but you can explore
            everything else on AppWeaver AI in the meantime.
          </p>
          <Button href="/" variant="outline" className="mt-2 h-[45px] px-6">
            Back to home
          </Button>
        </Container>
      </main>
      <Footer />
    </>
  );
}

