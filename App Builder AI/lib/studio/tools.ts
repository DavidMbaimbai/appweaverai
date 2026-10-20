export const STUDIO_TOOLS = [
  {
    id: 'brand-kit',
    label: 'Brand kit',
    group: 'Design',
    hint: 'Describe the business or app.',
    task: 'Create a brand kit: 5 name ideas, a tagline, brand voice (3 traits with do/don\'t examples), a colour palette with hex codes and where to use each, and a font pairing (free Google Fonts). Use markdown headings.',
  },
  {
    id: 'social-posts',
    label: 'Social posts',
    group: 'Marketing',
    hint: 'What are you promoting, and for whom?',
    task: 'Write 7 social media posts for a week (one per day) with a mix of formats (tip, story, question, announcement). For each give the post text, 3 or fewer hashtags and a suggested image idea. Label each with the best platform (X, LinkedIn, Instagram or Facebook).',
  },
  {
    id: 'ad-pack',
    label: 'Ad pack',
    group: 'Advertising',
    hint: 'What is the offer and who is the audience?',
    task: 'Write an advert pack: 3 Facebook/Instagram ads (headline max 40 chars, primary text max 125 chars, call to action) and 3 Google search ads (3 headlines max 30 chars, 2 descriptions max 90 chars). Add audience targeting suggestions and one A/B test idea.',
  },
  {
    id: 'email-campaign',
    label: 'Email campaign',
    group: 'Marketing',
    hint: 'Who are the subscribers and what should they do?',
    task: 'Write a 3-email sequence (welcome, value, offer). For each give subject line, preview text and body. Keep each body under 150 words.',
  },
  {
    id: 'seo-plan',
    label: 'SEO plan',
    group: 'Marketing',
    hint: 'Describe the site and its topic.',
    task: 'Create an SEO plan: 10 target keywords with search intent, 5 blog post outlines (title, H2 headings, meta description), and on-page fixes for a landing page.',
  },
  {
    id: 'launch-plan',
    label: '30-day launch plan',
    group: 'Strategy',
    hint: 'Describe the product, goal and budget.',
    task: 'Create a week-by-week 30-day go-to-market plan: goals, channels, daily/weekly actions, budget split if a budget is given, and the metrics to watch.',
  },
  {
    id: 'app-spec',
    label: 'App idea to build',
    group: 'Development',
    hint: 'Describe the app you want in plain language.',
    task: 'Turn this idea into a build brief: a one-paragraph summary, the main pages, core features in priority order, data to store, and a ready-to-paste prompt for an AI app builder.',
  },
] as const;

export type StudioToolId = (typeof STUDIO_TOOLS)[number]['id'] | 'image';

export const STUDIO_IMAGE_TOOL = {
  id: 'image' as const,
  label: 'Image / logo concept',
  group: 'Design',
  hint: 'Describe the image: subject, style, colours.',
};

export function isStudioToolId(value: unknown): value is StudioToolId {
  return value === 'image' || STUDIO_TOOLS.some((tool) => tool.id === value);
}

export const MAX_BRIEF_LENGTH = 2000;
