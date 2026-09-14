import { TestmonialDesktopCarousel } from './testimonial-desktop-carousel';
import { TeststimonialMobileCarousel } from './testimonial-mobile-carousel';
import { getFeaturedTestimonials } from '@/lib/reviews/queries';

export async function TestimonialSection() {
  const testimonials = await getFeaturedTestimonials();

  return (
    <>
      <TeststimonialMobileCarousel testimonials={testimonials} />
      <TestmonialDesktopCarousel testimonials={testimonials} />
    </>
  );
}
