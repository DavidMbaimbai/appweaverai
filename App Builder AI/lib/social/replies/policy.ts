import { isStopRequest, looksLikeReview, REVIEW_NOTE } from '@/lib/support-inbox/filters';

export const REPLY_PLATFORMS = [
  'X',
  'LINKEDIN',
  'FACEBOOK',
  'INSTAGRAM',
  'REDDIT',
  'YOUTUBE',
  'OTHER',
] as const;

export type ReplyPlatform = (typeof REPLY_PLATFORMS)[number];
export type Audience = 'USER' | 'INVESTOR' | 'IGNORE';

/** Maps free-form platform names ("twitter", "Reddit") to a known platform; unknown -> OTHER. */
export function normalizeReplyPlatform(input: unknown): ReplyPlatform {
  const value = String(input ?? '').trim().toUpperCase();
  if (value === 'TWITTER') return 'X';
  return (REPLY_PLATFORMS as readonly string[]).includes(value)
    ? (value as ReplyPlatform)
    : 'OTHER';
}

// Messages matching this are treated as investor traffic regardless of what the
// model says, so they can never be auto-sent.
const INVESTOR_PATTERN =
  /\b(invest(or|ors|ment|ing)?|vc|venture capital|angel|seed (round|funding)|series [a-d]|term sheet|pitch deck|valuation|cap table|fundrais\w*|funding round|due diligence|equity|portfolio compan\w*|limited partner|family office|acquisition|acquire|partner at|managing partner|general partner)\b/i;

export function looksLikeInvestor(text: string) {
  return INVESTOR_PATTERN.test(text);
}

function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

/** Guards against reply loops (our own accounts) and honours stop requests. */
export function shouldReplyToInteraction({
  authorHandle,
  ownHandles,
  text,
}: {
  authorHandle: string;
  ownHandles: string[];
  text: string;
}): { reply: boolean; reason?: string } {
  const author = normalizeHandle(authorHandle);
  if (!author) return { reply: false, reason: 'no author' };
  if (ownHandles.some((h) => normalizeHandle(h) === author)) {
    return { reply: false, reason: 'own account' };
  }
  if (isStopRequest(undefined, text)) return { reply: false, reason: 'stop request' };
  if (looksLikeReview(text)) return { reply: false, reason: REVIEW_NOTE };
  return { reply: true };
}

export type ReplyDecision =
  | { action: 'SEND' }
  | { action: 'HOLD'; reason: string }
  | { action: 'SKIP'; reason: string };

/**
 * Decides what happens to a drafted reply. Investors are always held for human
 * approval; users are auto-sent unless the draft is low-confidence or flagged
 * for escalation. `requireApproval` forces everything into the queue.
 */
export function decideReply({
  audience,
  confidence,
  escalate,
  minConfidence,
  requireApproval = false,
}: {
  audience: Audience;
  confidence: number;
  escalate: boolean;
  minConfidence: number;
  requireApproval?: boolean;
}): ReplyDecision {
  if (audience === 'IGNORE') return { action: 'SKIP', reason: 'no reply needed' };
  if (audience === 'INVESTOR') return { action: 'HOLD', reason: 'investor: needs approval' };
  if (requireApproval) return { action: 'HOLD', reason: 'approval required' };
  if (escalate) return { action: 'HOLD', reason: 'needs a human' };
  if (confidence < minConfidence) return { action: 'HOLD', reason: 'low confidence' };
  return { action: 'SEND' };
}

/** Trims a reply to the platform's character limit without cutting mid-word. */
export function fitReply(platform: ReplyPlatform, reply: string) {
  const limit = platform === 'X' ? 280 : 1000;
  const text = reply.trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
