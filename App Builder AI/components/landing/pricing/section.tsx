import { Container } from '@/components/ui/container';
import { PricingPlanClient } from './pricing-plans-client';
import { fetchProPlanInfo } from '@/lib/stripe';

export async function PricingSection() {
  const proPlan = await fetchProPlanInfo();
  const proMonthlyPrice = proPlan.displayMonthlyPrice ?? 25;

  return (
    <section id="pricing" className="py-12 desktop:py-20">
      <Container>
        <PricingPlanClient proMonthlyPrice={proMonthlyPrice} />
      </Container>
    </section>
  );
}
