import { prisma } from '@/lib/prisma';
import { testimonials as staticTestimonials, AVATAR_BASE } from '@/lib/landing-data';
import type { Testimonial } from '@/lib/types';

const MIN_TESTIMONIALS = 6;
const QUOTE_MAX_LENGTH = 280;

function displayNameFor(user: { name: string | null; email: string | null } | undefined, fallbackEmail: string | null) {
  if (user?.name) return user.name;
  const email = user?.email ?? fallbackEmail;
  if (!email) return 'AppWeaver AI user';
  const localPart = email.split('@')[0] ?? email;
  return localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}\u2026`;
}

/**
 * Marketing testimonials section is now driven by real, in-app product
 * reviews (rating >= 4 with a written comment) rather than only static
 * copy. When there aren't enough real reviews yet (e.g. a fresh install),
 * the list is padded out with the curated fallback testimonials so the
 * carousel is never sparse or empty.
 */
export async function getFeaturedTestimonials(limit = 8): Promise<Testimonial[]> {
  let real: Testimonial[] = [];

  try {
    const reviews = await prisma.productReview.findMany({
      where: { rating: { gte: 4 }, comment: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const userIds = [...new Set(reviews.map((review) => review.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.id, user]));

    real = reviews
      .filter((review) => Boolean(review.comment?.trim()))
      .map((review) => {
        const author = displayNameFor(userMap.get(review.userId), review.userEmail);
        return {
          id: review.id,
          quote: truncate(review.comment!.trim(), QUOTE_MAX_LENGTH),
          author,
          role: 'Verified user',
          company: 'AppWeaver AI',
          avatarUrl: `${AVATAR_BASE}${encodeURIComponent(author)}`,
        } satisfies Testimonial;
      });
  } catch (error) {
    console.error('Failed to load product review testimonials:', error);
    real = [];
  }

  if (real.length >= MIN_TESTIMONIALS) return real;

  const fillers = staticTestimonials.filter(
    (testimonial) => !real.some((r) => r.id === testimonial.id),
  );

  return [...real, ...fillers].slice(0, Math.max(limit, MIN_TESTIMONIALS));
}
