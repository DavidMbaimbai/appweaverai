import { createHash } from 'node:crypto';

import { blockingPredecessor, type SequencedRelease } from './series';

export type ReleaseStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'MANUAL'
  | 'CANCELLED'
  | 'PAUSED';

/**
 * DRAFT: saved, not ready. SCHEDULED: has a time, waiting for the owner's
 * approval. APPROVED: approved, publishes at its time. PUBLISHING: claimed by
 * one cron run. PUBLISHED only after the platform confirmed it.
 */
const TRANSITIONS: Record<ReleaseStatus, ReleaseStatus[]> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['DRAFT', 'APPROVED', 'PAUSED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'PAUSED', 'CANCELLED', 'PUBLISHING'],
  PAUSED: ['SCHEDULED', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'FAILED', 'MANUAL', 'APPROVED'],
  FAILED: ['SCHEDULED', 'APPROVED', 'CANCELLED'],
  MANUAL: ['SCHEDULED', 'APPROVED', 'CANCELLED'],
  PUBLISHED: [],
  CANCELLED: [],
};

export function canTransition(from: ReleaseStatus, to: ReleaseStatus) {
  return TRANSITIONS[from].includes(to);
}

/** Statuses whose content the owner may still edit or move. */
export const EDITABLE: ReleaseStatus[] = ['DRAFT', 'SCHEDULED', 'APPROVED', 'PAUSED', 'FAILED', 'MANUAL'];

/** Counted against the plan limit. */
export const PENDING: ReleaseStatus[] = ['SCHEDULED', 'APPROVED', 'PAUSED', 'PUBLISHING'];

export const FREE_PENDING_LIMIT = 5;
export const PAID_PENDING_LIMIT = 200;

export function pendingLimit(plan: string | null | undefined) {
  return !plan || plan === 'free' ? FREE_PENDING_LIMIT : PAID_PENDING_LIMIT;
}

export const MAX_ATTEMPTS = 3;
/** Overdue longer than this and an unapproved or unsent release is not published any more. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const BACKOFF_MS = [5 * 60_000, 15 * 60_000];

export function backoffMs(attemptsSoFar: number) {
  return BACKOFF_MS[Math.min(Math.max(attemptsSoFar, 1), BACKOFF_MS.length) - 1];
}

/** Outcome after a failed attempt: retry later (still APPROVED) or give up (FAILED). */
export function afterFailure(attemptsSoFar: number, retryable: boolean, now = new Date()) {
  if (retryable && attemptsSoFar < MAX_ATTEMPTS) {
    return { status: 'APPROVED' as const, nextAttemptAt: new Date(now.getTime() + backoffMs(attemptsSoFar)) };
  }
  return { status: 'FAILED' as const, nextAttemptAt: null };
}

/** Stable per release slot: scheduling the same video/platform/language/time twice is rejected. */
export function releaseIdempotencyKey(input: {
  userId: string;
  jobId: string;
  platform: string;
  language: string;
  scheduledAt: Date;
}) {
  return createHash('sha256')
    .update([input.userId, input.jobId, input.platform, input.language, input.scheduledAt.toISOString()].join('|'))
    .digest('hex')
    .slice(0, 48);
}

export type Dueable = SequencedRelease & {
  scheduledAt: Date;
  nextAttemptAt: Date | null;
  approvedAt: Date | null;
};

export type DuePlan<T> = { due: T[]; stale: T[]; blocked: { release: T; waitingFor: T }[] };

/**
 * Only APPROVED releases whose time has come are ever due. Unapproved ones
 * (SCHEDULED) never publish; those long overdue go stale. `siblings` are all
 * releases of the same owners so episode order can be enforced.
 */
export function planDue<T extends Dueable>(candidates: T[], siblings: T[], now = new Date()): DuePlan<T> {
  const plan: DuePlan<T> = { due: [], stale: [], blocked: [] };
  const sorted = [...candidates].sort(
    (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || (a.episode ?? 0) - (b.episode ?? 0),
  );
  for (const release of sorted) {
    if (release.scheduledAt.getTime() > now.getTime()) continue;
    if (now.getTime() - release.scheduledAt.getTime() > STALE_AFTER_MS) {
      if (release.status === 'APPROVED' || release.status === 'SCHEDULED') plan.stale.push(release);
      continue;
    }
    if (release.status !== 'APPROVED' || !release.approvedAt) continue;
    if (release.nextAttemptAt && release.nextAttemptAt.getTime() > now.getTime()) continue;
    const waitingFor = blockingPredecessor(release, siblings);
    if (waitingFor) plan.blocked.push({ release, waitingFor });
    else plan.due.push(release);
  }
  return plan;
}

type ClaimDelegate = {
  updateMany(args: {
    where: { id: string; status: 'APPROVED'; attempts: number };
    data: { status: 'PUBLISHING'; attempts: { increment: number }; nextAttemptAt: null };
  }): Promise<{ count: number }>;
};

/**
 * Row lock by status transition: only the run that flips APPROVED to
 * PUBLISHING (compared on the attempt count it read) may publish.
 */
export async function claimForPublish(delegate: ClaimDelegate, id: string, attemptsSeen: number) {
  const claim = await delegate.updateMany({
    where: { id, status: 'APPROVED', attempts: attemptsSeen },
    data: { status: 'PUBLISHING', attempts: { increment: 1 }, nextAttemptAt: null },
  });
  return claim.count === 1;
}
