export type NavLink = {
  label: string;
  href: string;
  accent?: boolean;
  description?: string;
};

type NavSubsection = {
  title: string;
  links: NavLink[];
};

export type NavGroup = {
  title: string;
  links?: NavLink[];
  subsections?: NavSubsection[];
};

export type ProjectCategory = {
  id: string;
  label: string;
  icon:
    | 'website'
    | 'mobile'
    | 'design'
    | 'slides'
    | 'animation'
    | 'data'
    | 'game'
    | 'document'
    | 'spreadsheet';
};

export type AgentFeature = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  variant: 'canvas' | 'parallel' | 'artifacts' | 'teams';
};

export type PlatformFeature = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  variant: 'agent' | 'infrastructure' | 'integrations' | 'enterprise';
};

export type Testimonial = {
  id: string;
  quote: string;
  author: string;
  role: string;
  company: string;
  avatarUrl: string;
};

export type PricingPlan = {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  originalPrice?: number;
  ctaLabel: string;
  ctaHref: string;
  /** Optional second CTA (used by Enterprise: "Contact sales" + "Get started"). */
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  features: string[];
  /** Small pill badges shown under the price, e.g. "AI integrations". */
  badges?: string[];
  /** Icon shown next to the plan name. */
  icon?: 'sparkle' | 'rocket';
  /** Heading shown above the feature list, e.g. "Everything in Starter plus:". */
  featuresIntro?: string;
  /** Visual accent used for the card border/highlight and icon color. */
  accent?: 'orange' | 'blue' | 'none';
};

export type BillingPeriod = 'monthly' | 'yearly';

export type ExamplePrompt = {
  label: string;
  text: string;
};
