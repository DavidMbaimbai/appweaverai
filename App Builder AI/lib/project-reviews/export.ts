import { toCsv } from '@/lib/investor-hub/csv';

export const REVIEW_CSV_HEADER = [
  'date',
  'rating',
  'author',
  'email',
  'review',
  'topic',
  'sentiment',
  'urgency',
  'status',
  'reply_status',
  'reply',
];

type ReviewRow = {
  createdAt: Date;
  rating: number;
  authorName: string;
  authorEmail: string | null;
  body: string;
  topic: string | null;
  sentiment: string | null;
  urgency: string | null;
  status: string;
  replyStatus: string;
  reply: string | null;
};

/** CSV of the owner's reviews; cells that could be read as spreadsheet formulas are neutralised. */
export function reviewsToCsv(reviews: ReviewRow[]) {
  return toCsv(
    REVIEW_CSV_HEADER,
    reviews.map((r) => [
      r.createdAt.toISOString(),
      r.rating,
      r.authorName,
      r.authorEmail,
      r.body,
      r.topic,
      r.sentiment,
      r.urgency,
      r.status,
      r.replyStatus,
      r.reply,
    ]),
  );
}
