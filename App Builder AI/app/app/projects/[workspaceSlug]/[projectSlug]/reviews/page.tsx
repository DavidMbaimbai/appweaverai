import { notFound } from 'next/navigation';

import { ReviewsDashboard } from '@/components/app/reviews/reviews-dashboard';
import { getCachedSession } from '@/lib/auth/cached';
import { prisma } from '@/lib/prisma';
import { projectAccessWhere } from '@/lib/projects/access';
import { summarizeReviews } from '@/lib/project-reviews/stats';
import { buildFixPrompt } from '@/lib/observatory/issues';
import { formatEvidenceForPrompt, type EvidenceBundle } from '@/lib/project-reviews/evidence-format';

type Props = { params: Promise<{ workspaceSlug: string; projectSlug: string }> };

export default async function ProjectReviewsPage({ params }: Props) {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId || !process.env.DATABASE_URL) notFound();

  const { workspaceSlug, projectSlug } = await params;
  const project = await prisma.project.findFirst({
    where: {
      slug: projectSlug,
      workspace: { slug: workspaceSlug },
      ...projectAccessWhere(userId),
    },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const [settings, reviews, knowledge, tickets, issues] = await Promise.all([
    prisma.projectReviewSettings.findUnique({ where: { projectId: project.id } }),
    prisma.projectReview.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.projectKnowledge.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, content: true },
    }),
    prisma.projectSupportTicket.findMany({
      where: { projectId: project.id, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, question: true, contact: true, createdAt: true },
    }),
    prisma.projectIssue.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const issueReviewIds = new Set(issues.map((i) => i.reviewId).filter(Boolean));

  return (
    <ReviewsDashboard
      projectId={project.id}
      projectName={project.name}
      builderHref={`/app/projects/${workspaceSlug}/${projectSlug}`}
      settings={{
        enabled: settings?.enabled ?? false,
        autoReplyPositive: settings?.autoReplyPositive ?? false,
        businessInfo: settings?.businessInfo ?? '',
        tone: (settings?.tone as 'friendly' | 'professional' | 'casual') ?? 'friendly',
        notifyEmail: settings?.notifyEmail ?? '',
        statusWebhookUrl: settings?.statusWebhookUrl ?? '',
      }}
      stats={summarizeReviews(reviews)}
      issues={issues.map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        status: i.status,
        analysis: i.analysis,
        proposedPlan: i.proposedPlan,
        fixPrompt: buildFixPrompt(i),
        verifiedAt: i.verifiedAt?.toISOString() ?? null,
      }))}
      reviews={reviews.map((r) => {
        const stored = r.evidence as { bundle?: EvidenceBundle; stateReasons?: string[] } | null;
        return {
          id: r.id,
          rating: r.rating,
          authorName: r.authorName,
          authorEmail: r.authorEmail,
          body: r.body,
          topic: r.topic,
          sentiment: r.sentiment,
          urgency: r.urgency,
          status: r.status,
          aiDraft: r.aiDraft,
          reply: r.reply,
          replyStatus: r.replyStatus,
          createdAt: r.createdAt.toISOString(),
          responseState: r.responseState,
          evidenceText: stored?.bundle ? formatEvidenceForPrompt(stored.bundle) : null,
          stateReasons: stored?.stateReasons ?? [],
          approvedAt: r.approvedAt?.toISOString() ?? null,
          hasIssue: issueReviewIds.has(r.id),
        };
      })}
      knowledge={knowledge}
      tickets={tickets.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
    />
  );
}
