import Link from 'next/link';

import type { enterprisePlan } from '@/lib/landing-data';

export function EnterprisePlanCard({ plan }: { plan: typeof enterprisePlan }) {
  return (
    <article className="flex flex-col items-center gap-6 rounded-[20px] border border-border-light bg-surface-dim px-6 py-10 text-center desktop:flex-row desktop:justify-between desktop:text-left">
      <div className="max-w-xl">
        <h3 className="font-display text-2xl font-semibold text-text-agent-heading">
          {plan.name}
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          {plan.featuresIntro}
        </p>

        <ul className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm text-text-secondary tablet:grid-cols-2">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-center justify-center gap-2.5 tablet:justify-start">
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 shrink-0 text-text-primary"
                aria-hidden="true">
                <path d="M4 10.5l4 4 8-9" />
              </svg>
              {feature}
            </li>
          ))}
        </ul>
      </div>

      <Link
        href={plan.ctaHref}
        className="shrink-0 rounded-full bg-surface-dark-card px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-black">
        {plan.ctaLabel}
      </Link>
    </article>
  );
}
