'use client';

import { Container } from '@/components/ui/container';
import { InfiniteCarousel } from '@/components/ui/infinite-carousel';
import { testimonials } from '@/lib/landing-data';
import { MobileTestimonialCard } from './testimonial-cards';

export function TeststimonialMobileCarousel() {
  return (
    <section id="testimonials" className="pt-[84] pb-12 desktop:hidden">
      <Container>
        <p className="text-xs font-semibold uppercase tracking-widest text-replit-orange">
          Endrosed by innovators
        </p>
        <h2 className="mt-2 font-display text-[32px] leading-[32px] font-normal tracking-[-0.04em] text-text-agent-heading">
          Trusted by builders
        </h2>
        <InfiniteCarousel
          items={testimonials}
          renderSlide={(testimonial) => (
            <MobileTestimonialCard testimonial={testimonial} />
          )}
          getDotLabel={(_, index) => `Go to testimonial ${index + 1}`}
          viewportClassName="mt-8"
        />
      </Container>
    </section>
  );
}
