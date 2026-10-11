export type ContentKind =
  | 'headline'
  | 'subheadline'
  | 'service'
  | 'about'
  | 'cta'
  | 'product'
  | 'meta';

export const CONTENT_KINDS: {
  id: ContentKind;
  label: string;
  guidance: string;
}[] = [
  {
    id: 'headline',
    label: 'Headline',
    guidance:
      'A clear, benefit-led main headline of at most 12 words. No trailing period.',
  },
  {
    id: 'subheadline',
    label: 'Subheadline',
    guidance: 'One supporting sentence (under 30 words) that expands on the headline.',
  },
  {
    id: 'service',
    label: 'Service description',
    guidance:
      'A 2-3 sentence description of a service: what it is, who it helps, the outcome.',
  },
  {
    id: 'about',
    label: 'About page',
    guidance:
      'An About section of 2-3 short paragraphs: who they are, what they do, why customers can trust them.',
  },
  {
    id: 'cta',
    label: 'Call to action',
    guidance: 'A short, action-oriented button label or line of at most 6 words.',
  },
  {
    id: 'product',
    label: 'Product description',
    guidance: 'A 2-3 sentence product description focused on benefits.',
  },
  {
    id: 'meta',
    label: 'Meta description',
    guidance: 'A search-result description of 140-155 characters.',
  },
];

export const CONTENT_TONES = [
  'Professional',
  'Friendly',
  'Bold',
  'Minimal',
  'Playful',
] as const;

export type ContentTone = (typeof CONTENT_TONES)[number];

export function isContentKind(value: unknown): value is ContentKind {
  return CONTENT_KINDS.some((k) => k.id === value);
}

export function isContentTone(value: unknown): value is ContentTone {
  return (CONTENT_TONES as readonly unknown[]).includes(value);
}

/** Extracts up to 3 non-empty string variants from a model's JSON-array reply. */
export function parseContentVariants(text: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim().slice(0, 2000))
      .slice(0, 3);
  } catch {
    return [];
  }
}
