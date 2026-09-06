import { TestmonialDesktopCarousel } from './testimonial-desktop-carousel';
import { TeststimonialMobileCarousel } from './testimonial-mobile-carousel';

export function TestimonialSection() {
  return (
    <>
      <TeststimonialMobileCarousel />
      <TestmonialDesktopCarousel />
    </>
  );
}
