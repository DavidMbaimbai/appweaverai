'use client';

import { platformFeatures } from '@/lib/landing-data';
import { PlatformCard } from './card';
import { InfiniteCarousel } from '@/components/ui/infinite-carousel';

export function MobilePlatformSlider() {
  return (
    <div className="mobile:block tablet-up:hidden">
      <InfiniteCarousel
        items={platformFeatures}
        renderSlide={(feature) => <PlatformCard feature={feature} />}
        getDotLabel={(_, index) => `Go to platform card ${index + 1}`}
        viewportClassName="mt-8"
      />
    </div>
  );
}
