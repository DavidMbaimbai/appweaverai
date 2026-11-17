import { Container } from '@/components/ui/container';
import { platformFeatures } from '@/lib/landing-data';
import { PlatformCard } from './card';
import { MobilePlatformSlider } from './mobile-slider';

export function PlatformSection() {
  return (
    <section className="pb-8 pt-16 desktop:pt-[120px]">
      <Container>
        <div className="text-center">
          <h2 className="font-display text-[32px] leading-[32px] tracking-[-1.92px] text-text-agent-heading tablet-up:text-[40px] tablet-up:leading-[40px] tablet-up:tracking-[-2.4px] desktop:text-[48px] desktop:leading-none desktop:tracking-[-0.06em]">
            One workspace to build, launch, market and grow
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-text-dim tablet-up:text-lg">
            Bring your idea from first draft to a live product, then keep
            improving and growing it with AppWeaver AI.
          </p>
        </div>

        <MobilePlatformSlider />

        <div className="mt-12 hidden grid-cols-1 gap-3 tablet-up:grid tablet-up:grid-cols-2 desktop-wide:flex desktop-wide:flex-row">
          {platformFeatures.map((feature) => (
            <PlatformCard key={feature.id} feature={feature} />
          ))}
        </div>
      </Container>
    </section>
  );
}

