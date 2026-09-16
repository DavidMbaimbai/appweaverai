import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { Container } from '@/components/ui/container';
import { PricingSection } from '@/components/landing/pricing/section';
import { getMarketingNavUser } from '@/lib/auth/nav-user';

export default async function PricingPage() {
  const initialUser = await getMarketingNavUser();

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16 tablet-up:py-24">
        <Container className="mb-10 flex flex-col items-center gap-4 text-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-appweaver-orange">
            Pricing
          </p>
          <h1 className="font-display text-[40px] leading-none tracking-[-1.6px] text-text-agent-heading tablet-up:text-[56px]">
            Plans for every builder
          </h1>
          <p className="max-w-[640px] font-display text-lg leading-snug text-text-dim">
            Start free, then upgrade when you need more credits, collaborators,
            deployments, or team controls.
          </p>
        </Container>
        <PricingSection />
      </main>
      <Footer />
    </>
  );
}
