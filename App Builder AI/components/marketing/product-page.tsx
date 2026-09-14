import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { getMarketingNavUser } from '@/lib/auth/nav-user';

export type ProductPageHighlight = {
  title: string;
  description: string;
};

export type ProductPageFaq = {
  question: string;
  answer: string;
};

export type ProductPageContent = {
  eyebrow: string;
  title: string;
  description: string;
  highlights: ProductPageHighlight[];
  faqs?: ProductPageFaq[];
  ctaLabel?: string;
  ctaHref?: string;
};

/**
 * Shared layout for the Products / For Work marketing pages (Agent, Design,
 * Databases, Publish Apps, Integrations, Mobile, Pro, Enterprise, ...).
 * These are always public — no sign-in required to view them.
 */
export async function ProductPage({
  eyebrow,
  title,
  description,
  highlights,
  faqs,
  ctaLabel = 'Start building for free',
  ctaHref = '/?autostart=1',
}: ProductPageContent) {
  const initialUser = await getMarketingNavUser();

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16 tablet-up:py-24">
        <Container className="flex flex-col items-center gap-6 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
            {eyebrow}
          </p>
          <h1 className="font-display text-[40px] leading-none tracking-[-1.6px] text-text-agent-heading tablet-up:text-[56px]">
            {title}
          </h1>
          <p className="max-w-[620px] font-display text-lg leading-snug text-text-dim">
            {description}
          </p>
          <Button href={ctaHref} className="mt-2 h-[45px] px-6">
            {ctaLabel}
          </Button>
        </Container>

        <Container className="mt-16 grid grid-cols-1 gap-4 tablet-up:mt-20 tablet-up:grid-cols-2">
          {highlights.map((highlight) => (
            <div
              key={highlight.title}
              className="rounded-[20px] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
              <p className="font-display text-xl tracking-[-0.02em] text-text-agent-heading">
                {highlight.title}
              </p>
              <p className="mt-2 font-display text-base leading-snug text-text-dim">
                {highlight.description}
              </p>
            </div>
          ))}
        </Container>

        {faqs && faqs.length > 0 ? (
          <Container className="mt-16 max-w-[760px] tablet-up:mt-20">
            <h2 className="font-display text-2xl tracking-[-0.02em] text-text-agent-heading">
              Frequently asked questions
            </h2>
            <div className="mt-6 space-y-6">
              {faqs.map((faq) => (
                <div key={faq.question}>
                  <p className="font-display text-lg text-text-agent-heading">
                    {faq.question}
                  </p>
                  <p className="mt-1.5 font-display text-base leading-relaxed text-text-dim">
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </Container>
        ) : null}

        <Container className="mt-12 flex justify-center">
          <Link
            href="/"
            className="text-sm text-text-agent-heading underline underline-offset-2 hover:text-text-primary">
            Back to home
          </Link>
        </Container>
      </main>
      <Footer />
    </>
  );
}
