import Image from 'next/image';
import { featureVariantConfig } from './feature-card-config';
import { cn } from '@/lib/utils';
import type { AgentFeature } from '@/lib/types';

type FeatureCardProps = {
  feature: AgentFeature;
  className?: string;
};

/**
 * A single, uniform card shape for every feature — a contained preview
 * window on top, copy below. Deliberately not the "giant pill + bleeding
 * illustration" bento layout used elsewhere on the web; every card here is
 * the same rounded rectangle regardless of variant.
 */
export function FeatureCard({ feature, className }: FeatureCardProps) {
  const config = featureVariantConfig[feature.variant];

  return (
    <article
      className={cn(
        'font-display flex flex-col overflow-hidden rounded-3xl p-6 tablet-up:p-8',
        config.bg,
        config.text,
        className,
      )}>
      <div className="mb-6 flex h-[180px] items-center justify-center overflow-hidden rounded-2xl bg-black/5 tablet-up:h-[220px]">
        <Image
          src={config.illustration}
          alt=""
          width={config.illustrationWidth}
          height={config.illustrationHeight}
          aria-hidden
          className={cn(
            'h-full w-full',
            config.illustrationFit === 'cover' ? 'object-cover' : 'object-contain p-6',
            config.illustrationClassName,
          )}
        />
      </div>

      <p
        className={cn(
          'text-[13px] font-medium uppercase tracking-[0.12em]',
          config.eyebrowClass,
        )}>
        {feature.eyebrow}
      </p>
      <h2 className="mt-2 text-[26px] font-normal leading-[1.15] tracking-[-0.04em] tablet-up:text-[32px]">
        {feature.title}
      </h2>
      <p className={cn('mt-3 text-[15px] leading-relaxed', config.descriptionClass)}>
        {feature.description}
      </p>
    </article>
  );
}
