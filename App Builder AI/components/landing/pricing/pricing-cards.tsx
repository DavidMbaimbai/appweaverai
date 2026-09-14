import Link from 'next/link';
import type { BillingPeriod, PricingPlan } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ProSeatSelect } from './pricing-pro-seat-select';

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true">
      <path d="M12 2l1.8 5.6L19.4 9.4 13.8 11.2 12 16.8 10.2 11.2 4.6 9.4 10.2 7.6 12 2z" />
      <path d="M19 14l.8 2.4L22.2 17.2 19.8 18 19 20.4 18.2 18 15.8 17.2 18.2 16.4 19 14z" />
    </svg>
  );
}

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true">
      <path d="M14.5 3.5c3 1 5 3 6 6-2 .5-4 1.5-6 3.5-2 2-3 4-3.5 6-3-1-5-3-6-6 1-2 3-4 5-5.5 1.5-1 3-3 4.5-4z" />
      <circle cx="14.5" cy="9.5" r="1.5" />
      <path d="M8 15l-2 2M9 18l-2 2M6 14l-2 2" />
    </svg>
  );
}

function PlanIcon({ icon, className }: { icon?: 'sparkle' | 'rocket'; className?: string }) {
  if (icon === 'sparkle') return <SparkleIcon className={className} />;
  if (icon === 'rocket') return <RocketIcon className={className} />;
  return null;
}

function PriceBlock({
  plan,
  period,
}: {
  plan: PricingPlan;
  period: BillingPeriod;
}) {
  if (plan.monthlyPrice === null) {
    return (
      <p className="mt-2 font-display text-base text-text-secondary">
        {plan.description}
      </p>
    );
  }

  const price = period === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
  const isFree = price === 0;
  const showStrike =
    period === 'yearly' &&
    plan.originalPrice != null &&
    plan.originalPrice > (price ?? 0);

  if (isFree) {
    return <p className="mt-2 font-display text-base text-text-secondary">Free</p>;
  }

  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-text-secondary">
      {showStrike && (
        <span className="line-through text-text-dim">${plan.originalPrice}</span>
      )}
      <span className="font-medium text-text-primary">${price}</span>
      <span>/ month, billed annually</span>
    </p>
  );
}

const ACCENT_STYLES: Record<
  NonNullable<PricingPlan['accent']>,
  { border: string; bg: string; icon: string; cta: string }
> = {
  orange: {
    border: 'border-replit-orange',
    bg: 'bg-[#fdf1ea]',
    icon: 'text-replit-orange',
    cta: 'bg-replit-orange text-white hover:bg-replit-orange/90',
  },
  blue: {
    border: 'border-border-light',
    bg: 'bg-surface-white',
    icon: 'text-sky-500',
    cta: 'bg-sky-500 text-white hover:bg-sky-600',
  },
  none: {
    border: 'border-border-light',
    bg: 'bg-surface-white',
    icon: 'text-text-secondary',
    cta: 'border border-border-light bg-surface-white text-text-primary hover:bg-surface-dim',
  },
};

export function PricingCard({
  plan,
  period,
}: {
  plan: PricingPlan;
  period: BillingPeriod;
}) {
  const accent = ACCENT_STYLES[plan.accent ?? 'none'];

  return (
    <article
      className={cn(
        'flex flex-col rounded-[20px] border p-6',
        accent.border,
        accent.bg,
      )}>
      <div className="flex items-center gap-2">
        <h3 className="font-display text-2xl font-semibold text-text-agent-heading">
          {plan.name}
        </h3>
        <PlanIcon icon={plan.icon} className={cn('h-5 w-5', accent.icon)} />
      </div>

      <PriceBlock plan={plan} period={period} />

      {plan.badges && plan.badges.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {plan.badges.map((badge) => (
            <span
              key={badge}
              className="rounded-full bg-black/[0.05] px-3 py-1 text-xs font-medium text-text-secondary">
              {badge}
            </span>
          ))}
        </div>
      )}

      {plan.featuresIntro && (
        <p className="mt-5 text-sm font-medium text-text-secondary">
          {plan.featuresIntro}
        </p>
      )}

      <ul className="mt-3 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2.5 text-sm text-text-secondary">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 h-4 w-4 shrink-0 text-text-primary">
              <path d="M4 10.5l4 4 8-9" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      {plan.id === 'pro' && <ProSeatSelect period={period} />}

      <div className="mt-6 space-y-2">
        <Link
          href={plan.ctaHref}
          className={cn(
            'flex items-center justify-center gap-2 rounded-full py-3 text-center text-sm font-medium transition-colors',
            accent.cta,
          )}>
          {plan.ctaLabel}
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0"
            aria-hidden="true">
            <path d="M4 10h12M11 5l5 5-5 5" />
          </svg>
        </Link>
        {plan.secondaryCtaLabel && plan.secondaryCtaHref && (
          <Link
            href={plan.secondaryCtaHref}
            className="block rounded-full bg-surface-dark-card py-3 text-center text-sm font-medium text-white transition-colors hover:bg-black">
            {plan.secondaryCtaLabel}
          </Link>
        )}
      </div>
    </article>
  );
}

