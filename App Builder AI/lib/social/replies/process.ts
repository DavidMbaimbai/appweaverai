import { sendAlert } from '@/lib/alerts';
import { recordInternalOperation } from '@/lib/marketing-credits/internal-cost';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { generateSocialReply } from '@/lib/social/replies/generate';
import {
  decideReply,
  fitReply,
  normalizeReplyPlatform,
  shouldReplyToInteraction,
} from '@/lib/social/replies/policy';
import { sendSocialReply } from '@/lib/social/replies/send';
import { looksLikeReview, REVIEW_NOTE } from '@/lib/support-inbox/filters';

const MAX_PER_RUN = 20;
const MAX_ATTEMPTS = 3;
// Replies below this confidence are held for a human instead of auto-sent.
const MIN_CONFIDENCE = Number(process.env.SOCIAL_REPLY_MIN_CONFIDENCE ?? 0.7);
// Hard cap per author per day: stops ping-pong loops with bots.
const MAX_AUTO_REPLIES_PER_AUTHOR_PER_DAY = 3;
// A worker that died mid-run leaves PROCESSING rows; reclaim them after this long.
const STALE_PROCESSING_MS = 15 * 60 * 1000;

function ownHandles() {
  return (process.env.SOCIAL_OWN_HANDLES ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

function requireApproval() {
  return process.env.SOCIAL_REPLY_REQUIRE_APPROVAL === 'true';
}

export type IngestInput = {
  platform: unknown;
  externalId: string;
  replyToId?: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  /** The source says this is a review/rating; it is stored for a human and never answered by AI. */
  isReview?: boolean;
};

/** Stores an inbound message. Re-delivery of the same platform message is a no-op. */
export async function ingestInteraction(input: IngestInput) {
  const platform = normalizeReplyPlatform(input.platform);
  const review = input.isReview === true || looksLikeReview(input.text);
  const data = {
    platform,
    externalId: input.externalId,
    replyToId: input.replyToId,
    authorHandle: input.authorHandle,
    authorName: input.authorName,
    text: input.text,
    ...(review ? { status: 'SKIPPED' as const, note: REVIEW_NOTE } : {}),
  };
  const existing = await prisma.socialInteraction.findUnique({
    where: { platform_externalId: { platform, externalId: input.externalId } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false as const };

  try {
    const created = await prisma.socialInteraction.create({ data, select: { id: true } });
    return { id: created.id, created: true as const };
  } catch (error) {
    // Lost a race with a concurrent delivery of the same message.
    const raced = await prisma.socialInteraction.findUnique({
      where: { platform_externalId: { platform, externalId: input.externalId } },
      select: { id: true },
    });
    if (raced) return { id: raced.id, created: false as const };
    throw error;
  }
}

type Interaction = NonNullable<Awaited<ReturnType<typeof prisma.socialInteraction.findUnique>>>;

/** Sends `text` for an interaction already claimed (PROCESSING) and records the outcome. */
async function deliver(interaction: Interaction, text: string) {
  const platform = normalizeReplyPlatform(interaction.platform);
  const reply = fitReply(platform, text);
  const result = await sendSocialReply({
    platform,
    externalId: interaction.externalId,
    replyToId: interaction.replyToId,
    authorHandle: interaction.authorHandle,
    text: reply,
  }).catch((error) => ({ ok: false, error: String(error) }));

  const attempts = interaction.attempts + 1;
  await prisma.socialInteraction.update({
    where: { id: interaction.id },
    data: {
      reply,
      result,
      attempts,
      status: result.ok ? 'SENT' : 'FAILED',
      repliedAt: result.ok ? new Date() : null,
      note: result.ok ? interaction.note : (result.error ?? 'send failed').slice(0, 500),
    },
  });
  return result.ok;
}

export type RepliesResult = {
  sent: number;
  held: number;
  skipped: number;
  failed: number;
};

/** Classifies and answers new interactions: users are auto-sent, investors are queued for approval. */
export async function processSocialReplies(): Promise<RepliesResult> {
  const result: RepliesResult = { sent: 0, held: 0, skipped: 0, failed: 0 };

  await prisma.socialInteraction.updateMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) },
    },
    data: { status: 'RECEIVED' },
  });

  const batch = await prisma.socialInteraction.findMany({
    where: { status: 'RECEIVED' },
    orderBy: { createdAt: 'asc' },
    take: MAX_PER_RUN,
  });

  for (const item of batch) {
    const claimed = await prisma.socialInteraction.updateMany({
      where: { id: item.id, status: 'RECEIVED' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count === 0) continue;

    try {
      const platform = normalizeReplyPlatform(item.platform);
      const gate = shouldReplyToInteraction({
        authorHandle: item.authorHandle,
        ownHandles: ownHandles(),
        text: item.text,
      });
      if (!gate.reply) {
        await prisma.socialInteraction.update({
          where: { id: item.id },
          data: { status: 'SKIPPED', note: gate.reason },
        });
        result.skipped += 1;
        continue;
      }

      const draft = await generateSocialReply({
        platform,
        authorHandle: item.authorHandle,
        authorName: item.authorName,
        text: item.text,
      });
      // House account: no customer wallet, only the internal cost ledger.
      await recordInternalOperation('engagement_reply', { refType: 'social_interaction', refId: item.id });
      const decision = decideReply({
        audience: draft.audience,
        confidence: draft.confidence,
        escalate: draft.escalate,
        minConfidence: MIN_CONFIDENCE,
        requireApproval: requireApproval(),
      });

      const base = {
        audience: draft.audience,
        confidence: draft.confidence,
        escalate: draft.escalate,
        reply: draft.reply ? fitReply(platform, draft.reply) : null,
      };

      if (decision.action === 'SKIP') {
        await prisma.socialInteraction.update({
          where: { id: item.id },
          data: {
            ...base,
            status: 'SKIPPED',
            note: draft.review ? REVIEW_NOTE : decision.reason,
          },
        });
        result.skipped += 1;
        continue;
      }

      if (decision.action === 'HOLD') {
        await prisma.socialInteraction.update({
          where: { id: item.id },
          data: { ...base, status: 'PENDING_APPROVAL', note: decision.reason },
        });
        result.held += 1;
        if (draft.audience === 'INVESTOR') {
          await sendAlert(
            `Investor message on ${platform} needs approval`,
            `@${item.authorHandle}: ${item.text.slice(0, 300)}`,
          );
        }
        continue;
      }

      const limit = await rateLimit(
        `social-reply:${platform}:${item.authorHandle.toLowerCase()}`,
        MAX_AUTO_REPLIES_PER_AUTHOR_PER_DAY,
        24 * 60 * 60 * 1000,
      );
      if (!limit.ok) {
        await prisma.socialInteraction.update({
          where: { id: item.id },
          data: { ...base, status: 'SKIPPED', note: 'daily reply cap for author' },
        });
        result.skipped += 1;
        continue;
      }

      await prisma.socialInteraction.update({ where: { id: item.id }, data: base });
      const delivered = await deliver({ ...item, ...base }, draft.reply);
      if (delivered) result.sent += 1;
      else result.failed += 1;
    } catch (error) {
      const attempts = item.attempts + 1;
      console.error(`[social-replies] failed to process ${item.id}:`, error);
      await prisma.socialInteraction.update({
        where: { id: item.id },
        data: {
          attempts,
          status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'RECEIVED',
          note: String(error).slice(0, 500),
        },
      });
      result.failed += 1;
    }
  }

  return result;
}

export type ReviewAction =
  | { action: 'approve'; reply?: string }
  | { action: 'reject' };

/**
 * Human review of a held (or failed) interaction: approve sends the draft (optionally
 * edited), reject skips it. Returns a status the API maps to an HTTP code.
 */
export async function reviewInteraction(id: string, review: ReviewAction) {
  if (review.action === 'reject') {
    const { count } = await prisma.socialInteraction.updateMany({
      where: { id, status: { in: ['PENDING_APPROVAL', 'FAILED'] } },
      data: { status: 'SKIPPED', note: 'rejected by reviewer' },
    });
    return count ? ({ ok: true } as const) : ({ ok: false, error: 'not-reviewable' } as const);
  }

  // Claim first so a double-click can't send the reply twice.
  const { count } = await prisma.socialInteraction.updateMany({
    where: { id, status: { in: ['PENDING_APPROVAL', 'FAILED'] } },
    data: { status: 'PROCESSING' },
  });
  if (!count) return { ok: false, error: 'not-reviewable' } as const;

  const item = await prisma.socialInteraction.findUniqueOrThrow({ where: { id } });
  const text = review.reply?.trim() || item.reply?.trim();
  if (!text) {
    await prisma.socialInteraction.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', note: 'no reply text to send' },
    });
    return { ok: false, error: 'empty-reply' } as const;
  }

  const sent = await deliver(item, text);
  return sent ? ({ ok: true } as const) : ({ ok: false, error: 'send-failed' } as const);
}
