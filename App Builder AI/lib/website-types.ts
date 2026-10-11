export type WebsiteType = {
  id: string;
  label: string;
  /** Appended to the first message so the agent builds the right kind of site. */
  guidance: string;
};

export const WEBSITE_TYPES: WebsiteType[] = [
  {
    id: 'portfolio',
    label: 'Portfolio',
    guidance:
      'a personal portfolio: hero with name and role, featured projects, about/process, testimonials and contact details',
  },
  {
    id: 'small-business',
    label: 'Small business',
    guidance:
      'a local small-business site: services, customer reviews, opening hours/location and a clear contact or quote form',
  },
  {
    id: 'agency',
    label: 'Agency',
    guidance:
      'an agency site: services, case studies, team, client logos and a lead-capture contact form',
  },
  {
    id: 'saas',
    label: 'SaaS / product',
    guidance:
      'a SaaS or product landing page: value proposition, features, pricing tiers, FAQ and a strong call to action',
  },
  {
    id: 'restaurant',
    label: 'Restaurant / cafe',
    guidance:
      'a restaurant or cafe site: menu, gallery, opening hours, location and reservation/contact details',
  },
  {
    id: 'store',
    label: 'Online store',
    guidance:
      'a product showcase store: product grid, product details, benefits, reviews and a clear way to enquire or order',
  },
  {
    id: 'blog',
    label: 'Blog',
    guidance:
      'a blog: featured posts, post list, about the author and a newsletter sign-up form',
  },
  {
    id: 'event',
    label: 'Event',
    guidance:
      'an event site: date and venue, schedule, speakers, tickets/registration call to action and FAQ',
  },
  {
    id: 'nonprofit',
    label: 'Nonprofit',
    guidance:
      'a nonprofit site: mission, impact, ways to help or donate, stories and contact details',
  },
];

export function getWebsiteType(id: unknown): WebsiteType | null {
  return WEBSITE_TYPES.find((t) => t.id === id) ?? null;
}

export function withWebsiteTypeGuidance(
  prompt: string,
  type: WebsiteType | null,
) {
  if (!type) return prompt;
  return `${prompt}\n\nWebsite type: ${type.label}. Build ${type.guidance}.`;
}
