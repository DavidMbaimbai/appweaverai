import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { getCachedSession } from '@/lib/auth/cached';

export type LegalSection = {
  heading: string;
  body: string[];
};

export type LegalPageContent = {
  title: string;
  lastUpdated: string;
  intro: string[];
  sections: LegalSection[];
};

/**
 * Shared layout for long-form legal documents (Terms, Privacy, Commercial
 * Agreement, Subprocessors, DPA, Report Abuse). Public, no sign-in required.
 */
export async function LegalPage({
  title,
  lastUpdated,
  intro,
  sections,
}: LegalPageContent) {
  const session = await getCachedSession();
  const initialUser = session?.user
    ? { name: session.user.name, email: session.user.email }
    : null;

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16 tablet-up:py-24">
        <Container className="max-w-[760px]">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-replit-orange">
            Legal
          </p>
          <h1 className="mt-3 font-display text-[36px] leading-none tracking-[-1.4px] text-text-agent-heading tablet-up:text-[48px]">
            {title}
          </h1>
          <p className="mt-3 text-sm text-text-dim">Last updated: {lastUpdated}</p>

          <div className="mt-8 space-y-4">
            {intro.map((paragraph, index) => (
              <p
                key={index}
                className="font-display text-base leading-relaxed text-text-dim">
                {paragraph}
              </p>
            ))}
          </div>

          <div className="mt-10 space-y-10">
            {sections.map((section, index) => (
              <div key={section.heading}>
                <h2 className="font-display text-2xl tracking-[-0.02em] text-text-agent-heading">
                  {index + 1}. {section.heading}
                </h2>
                <div className="mt-3 space-y-3">
                  {section.body.map((paragraph, pIndex) => (
                    <p
                      key={pIndex}
                      className="font-display text-base leading-relaxed text-text-dim">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12">
            <Link
              href="/"
              className="text-sm text-text-agent-heading underline underline-offset-2 hover:text-text-primary">
              Back to home
            </Link>
          </div>
        </Container>
      </main>
      <Footer />
    </>
  );
}
