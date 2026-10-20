import { sendEmail } from '@/lib/email';
import { createIssueFromReview, isDefectReview } from '@/lib/observatory/issues';
import { prisma } from '@/lib/prisma';
import { withScopeMarketing } from '@/lib/marketing-credits/system';

import { analyzeReview, type ReviewAnalysis } from './ai';
import { emptyBundle, gatherEvidenceBundle } from './evidence';
import { formatEvidenceForPrompt, hasRelevantEvidence } from './evidence-format';
import { decideReply } from './policy';
import { decideResponseState, mayAutoSend } from './response-state';
import { escapeHtml } from './validate';

const DAILY_ANALYSIS_CAP = 100;

async function ownerEmail(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      notificationEmail: true,
      createdBy: { select: { email: true } },
      workspace: { select: { slug: true, owner: { select: { email: true } } } },
      slug: true,
      reviewSettings: { select: { notifyEmail: true } },
    },
  });
  if (!project) return null;
  return {
    name: project.name,
    to:
      project.reviewSettings?.notifyEmail ||
      project.notificationEmail ||
      project.createdBy?.email ||
      project.workspace?.owner?.email ||
      null,
    dashboardPath: `/app/projects/${project.workspace.slug}/${project.slug}/reviews`,
  };
}

/** Emails the owner. Never throws. */
export async function notifyOwnerOfReview(input: {
  projectId: string;
  rating: number;
  authorName: string;
  body: string;
  reasons: string[];
}) {
  try {
    const owner = await ownerEmail(input.projectId);
    if (!owner?.to) return;
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
    const text = [
      `A review on ${owner.name} needs your attention (${input.rating}/5 from ${input.authorName}).`,
      `Why: ${input.reasons.join('; ')}`,
      '',
      input.body.slice(0, 1000),
      '',
      `Review it and approve a reply: ${base}${owner.dashboardPath}`,
    ].join('\n');
    await sendEmail({
      to: owner.to,
      subject: `Review needs attention on ${owner.name} (${input.rating}/5)`,
      text,
      html: `<p>A review on <strong>${escapeHtml(owner.name)}</strong> needs your attention (<strong>${input.rating}/5</strong> from ${escapeHtml(input.authorName)}).</p><p>Why: ${escapeHtml(input.reasons.join('; '))}</p><blockquote style="white-space:pre-wrap">${escapeHtml(input.body.slice(0, 1000))}</blockquote><p><a href="${base}${owner.dashboardPath}">Review it and approve a reply</a></p>`,
    });
  } catch (error) {
    console.error('Review owner notification failed:', error);
  }
}

/** Records what the owner changed relative to the AI draft, for later quality review. */
export function computeCorrection(original: string | null | undefined, final: string) {
  if (!original) return { type: 'written_by_owner' as const };
  if (original.trim() === final.trim()) return { type: 'unchanged' as const };
  return { type: 'edited' as const, originalLength: original.length, finalLength: final.length };
}

/** Marks a reply as sent and emails the reviewer when they left an address. */
export async function sendReviewReply(
  reviewId: string,
  reply: string,
  approver?: { id: string; role: 'owner' | 'admin' },
) {
  const now = new Date();
  let extra: Record<string, unknown> = { repliedAt: now };
  if (approver) {
    const current = await prisma.projectReview.findUnique({
      where: { id: reviewId },
      select: { draftOriginal: true, aiDraft: true },
    });
    extra = {
      ...extra,
      approvedById: approver.id,
      approvedAt: now,
      corrections: { ...computeCorrection(current?.draftOriginal ?? current?.aiDraft, reply), by: approver.role },
    };
  }
  const review = await prisma.projectReview.update({
    where: { id: reviewId },
    data: { reply, replyStatus: 'SENT', ...extra },
    select: { authorEmail: true, authorName: true, projectId: true },
  });
  if (!review.authorEmail) return;
  try {
    const owner = await ownerEmail(review.projectId);
    await sendEmail({
      to: review.authorEmail,
      subject: `${owner?.name ?? 'The team'} replied to your review`,
      text: `Hi ${review.authorName},\n\n${reply}\n\n— ${owner?.name ?? 'The team'}`,
      html: `<p>Hi ${escapeHtml(review.authorName)},</p><p style="white-space:pre-wrap">${escapeHtml(reply)}</p><p>— ${escapeHtml(owner?.name ?? 'The team')}</p>`,
    });
  } catch (error) {
    console.error('Review reply email failed:', error);
  }
}

/** Classifies, drafts and applies the reply policy to a freshly stored review. Never throws. */
export async function processNewReview(reviewId: string) {
  try {
    const review = await prisma.projectReview.findUnique({ where: { id: reviewId } });
    if (!review) return;
    const settings = await prisma.projectReviewSettings.findUnique({
      where: { projectId: review.projectId },
    });
    if (!settings?.enabled) return;

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await prisma.aiUsageEvent.count({
      where: { projectId: review.projectId, provider: 'project-reviews', createdAt: { gte: startOfDay } },
    });

    let analysis: ReviewAnalysis | null = null;
    const bundle = await gatherEvidenceBundle({
      projectId: review.projectId,
      reviewId: review.id,
      body: review.body,
      statusWebhookUrl: settings.statusWebhookUrl,
    }).catch(() => emptyBundle());

    const owner = await prisma.project.findUnique({
      where: { id: review.projectId },
      select: { createdById: true },
    });
    const analysisCharge =
      used >= DAILY_ANALYSIS_CAP || !owner
        ? null
        : await withScopeMarketing(
            { scope: { type: 'PROJECT', projectId: review.projectId },
              operation: 'engagement_reply',
              idempotencyKey: `review-ai:${review.id}`,
              retryable: true,
              refType: 'ProjectReview',
              refId: review.id,
              isFailure: (r: ReviewAnalysis | null) => r === null,
            },
            () =>
              analyzeReview({
                projectId: review.projectId,
                rating: review.rating,
                authorName: review.authorName,
                body: review.body,
                businessInfo: settings.businessInfo,
                tone: settings.tone,
                evidence: formatEvidenceForPrompt(bundle),
              }).catch((error) => {
                console.error('Review analysis failed:', error);
                return null;
              }),
          );
    // Out of credits: skip the AI draft and fall back to owner approval.
    if (analysisCharge?.ok) analysis = analysisCharge.value;

    const decision = decideReply(
      {
        rating: review.rating,
        body: review.body,
        sentiment: analysis?.sentiment,
        urgency: analysis?.urgency,
      },
      settings,
    );
    const responseState = decideResponseState({
      review: {
        rating: review.rating,
        body: review.body,
        sentiment: analysis?.sentiment,
        urgency: analysis?.urgency,
      },
      settings,
      hasRelevantEvidence: hasRelevantEvidence(bundle),
    });
    const draft = analysis?.reply || null;

    await prisma.projectReview.update({
      where: { id: review.id },
      data: {
        topic: analysis?.topic ?? null,
        sentiment: analysis?.sentiment ?? null,
        urgency: analysis?.urgency ?? null,
        aiDraft: draft,
        draftOriginal: draft,
        replyStatus: draft ? 'DRAFT' : 'NONE',
        responseState: responseState.state,
        evidence: JSON.parse(JSON.stringify({ bundle, stateReasons: responseState.reasons })),
      },
    });

    if (analysis && isDefectReview(analysis.topic, analysis.sentiment)) {
      await createIssueFromReview(review.id, { auto: true }).catch((error) =>
        console.error('Auto issue creation failed:', error),
      );
    }

    if (mayAutoSend(responseState.state, decision.action) && draft) {
      await sendReviewReply(review.id, draft);
    } else if (
      (decision.action === 'HOLD_FOR_APPROVAL' && decision.notifyOwner) ||
      responseState.state === 'ESCALATION_REQUIRED'
    ) {
      await notifyOwnerOfReview({
        projectId: review.projectId,
        rating: review.rating,
        authorName: review.authorName,
        body: review.body,
        reasons: [...decision.reasons, ...responseState.reasons],
      });
    }
  } catch (error) {
    console.error('Review processing failed:', error);
  }
}
