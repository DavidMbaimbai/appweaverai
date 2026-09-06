import { AgentSection } from '@/components/landing/agent/section';
import { CtaSection } from '@/components/landing/cta/section';
import { AboveTheFold } from '@/components/landing/hero/above-the-fold';
import { PlatformSection } from '@/components/landing/platform/section';
import { PricingSection } from '@/components/landing/pricing/section';
import { TestimonialSection } from '@/components/landing/testimonials/section';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { getCachedSession } from '@/lib/auth/cached';

export default async function HomePage() {
  const session = await getCachedSession();
  const initialUser = session?.user
    ? { name: session.user.name, email: session.user.email }
    : null;
  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[50vh]">
        <AboveTheFold />
        <AgentSection />
        <PlatformSection />
        <TestimonialSection />
        <PricingSection />
        <CtaSection />
      </main>
      <Footer />
    </>
  );
}
