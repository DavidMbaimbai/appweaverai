import { z } from 'zod';

export const reviewSubmitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  authorName: z.string().trim().min(1).max(80),
  authorEmail: z.string().trim().email().max(200).optional().or(z.literal('')),
  body: z.string().trim().min(3).max(2000),
  // Honeypot: real users never fill this hidden field.
  website: z.string().max(200).optional(),
});

export type ReviewSubmit = z.infer<typeof reviewSubmitSchema>;

/** Cheap spam heuristics: links, repeated characters, shouting, and common spam phrases. */
export function looksLikeSpam(input: { body: string; authorName: string; website?: string }): boolean {
  if (input.website && input.website.trim()) return true;
  const text = `${input.authorName} ${input.body}`;
  const links = text.match(/https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|ru|xyz|top|biz|info)\b/gi) ?? [];
  if (links.length >= 2) return true;
  if (/(.)\1{9,}/.test(text)) return true;
  if (/\b(viagra|casino|crypto giveaway|seo services|buy followers|click here|earn \$)/i.test(text)) return true;
  const letters = input.body.replace(/[^A-Za-z]/g, '');
  if (letters.length > 30 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.8) return true;
  return false;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
