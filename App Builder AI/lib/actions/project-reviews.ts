'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCachedSession } from '../auth/cached';
import { prisma } from '../prisma';
import { projectAccessWhere } from '../projects/access';
import { sendReviewReply } from '../project-reviews/service';
import { isValidStatusWebhookUrl } from '../project-reviews/status-webhook';
import { analyzeIssue, approveIssue, createIssueFromReview, verifyIssue } from '../observatory/issues';

async function requireUser() {
  const session = await getCachedSession();
  return session?.user?.id ?? null;
}

async function ownsProject(projectId: string, userId: string) {
  return Boolean(
    await prisma.project.findFirst({
      where: { id: projectId, ...projectAccessWhere(userId) },
      select: { id: true },
    }),
  );
}

/** Loads a review only if the caller can access its project. */
async function accessibleReview(reviewId: string, userId: string) {
  return prisma.projectReview.findFirst({
    where: { id: reviewId, project: projectAccessWhere(userId) },
    select: { id: true, projectId: true },
  });
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  autoReplyPositive: z.boolean(),
  businessInfo: z.string().max(4000),
  tone: z.enum(['friendly', 'professional', 'casual']),
  notifyEmail: z.string().trim().email().max(200).or(z.literal('')),
  statusWebhookUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || isValidStatusWebhookUrl(v), 'Must be a public https URL')
    .optional(),
});

export async function saveReviewSettingsAction(
  projectId: string,
  input: z.input<typeof settingsSchema>,
) {
  const userId = await requireUser();
  if (!userId || !(await ownsProject(projectId, userId))) return { error: 'Unauthorized' };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid settings.' };
  const data = {
    ...parsed.data,
    notifyEmail: parsed.data.notifyEmail || null,
    statusWebhookUrl: parsed.data.statusWebhookUrl || null,
  };
  await prisma.projectReviewSettings.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });
  revalidatePath('/app/projects');
  return { ok: true };
}

export async function sendReviewReplyAction(reviewId: string, reply: string) {
  const userId = await requireUser();
  if (!userId) return { error: 'Unauthorized' };
  const text = reply.trim().slice(0, 1500);
  if (!text) return { error: 'Reply cannot be empty.' };
  const review = await accessibleReview(reviewId, userId);
  if (!review) return { error: 'Not found.' };
  await sendReviewReply(review.id, text, { id: userId, role: 'owner' });
  revalidatePath('/app/projects');
  return { ok: true };
}

/** Loads an issue only if the caller can access its project. */
async function accessibleIssue(issueId: string, userId: string) {
  const issue = await prisma.projectIssue.findUnique({ where: { id: issueId }, select: { id: true, projectId: true } });
  return issue && (await ownsProject(issue.projectId, userId)) ? issue : null;
}

export async function createIssueFromReviewAction(reviewId: string) {
  const userId = await requireUser();
  if (!userId) return { error: 'Unauthorized' };
  if (!(await accessibleReview(reviewId, userId))) return { error: 'Not found.' };
  const issue = await createIssueFromReview(reviewId, { createdById: userId });
  revalidatePath('/app/projects');
  return issue ? { ok: true } : { error: 'Could not create the issue.' };
}

export async function analyzeIssueAction(issueId: string) {
  const userId = await requireUser();
  if (!userId || !(await accessibleIssue(issueId, userId))) return { error: 'Not found.' };
  const result = await analyzeIssue(issueId);
  revalidatePath('/app/projects');
  return 'error' in result ? { error: result.error } : { ok: true };
}

export async function approveIssueAction(issueId: string) {
  const userId = await requireUser();
  if (!userId || !(await accessibleIssue(issueId, userId))) return { error: 'Not found.' };
  const result = await approveIssue(issueId, userId);
  revalidatePath('/app/projects');
  return 'error' in result ? { error: result.error } : { ok: true };
}

export async function verifyIssueAction(issueId: string) {
  const userId = await requireUser();
  if (!userId || !(await accessibleIssue(issueId, userId))) return { error: 'Not found.' };
  const result = await verifyIssue(issueId);
  revalidatePath('/app/projects');
  return result.verified ? { ok: true } : { error: result.reason };
}

export async function setReviewStatusAction(reviewId: string, status: 'PUBLISHED' | 'HIDDEN') {
  const userId = await requireUser();
  if (!userId) return { error: 'Unauthorized' };
  if (status !== 'PUBLISHED' && status !== 'HIDDEN') return { error: 'Invalid status.' };
  const review = await accessibleReview(reviewId, userId);
  if (!review) return { error: 'Not found.' };
  await prisma.projectReview.update({ where: { id: review.id }, data: { status } });
  revalidatePath('/app/projects');
  return { ok: true };
}

const knowledgeSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(4000),
});

const MAX_KNOWLEDGE_DOCS = 100;

export async function addKnowledgeAction(projectId: string, input: { title: string; content: string }) {
  const userId = await requireUser();
  if (!userId || !(await ownsProject(projectId, userId))) return { error: 'Unauthorized' };
  const parsed = knowledgeSchema.safeParse(input);
  if (!parsed.success) return { error: 'Add a title and some content.' };
  if ((await prisma.projectKnowledge.count({ where: { projectId } })) >= MAX_KNOWLEDGE_DOCS) {
    return { error: `Limit of ${MAX_KNOWLEDGE_DOCS} entries reached.` };
  }
  await prisma.projectKnowledge.create({ data: { projectId, ...parsed.data } });
  revalidatePath('/app/projects');
  return { ok: true };
}

export async function deleteKnowledgeAction(docId: string) {
  const userId = await requireUser();
  if (!userId) return { error: 'Unauthorized' };
  const { count } = await prisma.projectKnowledge.deleteMany({
    where: { id: docId, project: projectAccessWhere(userId) },
  });
  if (!count) return { error: 'Not found.' };
  revalidatePath('/app/projects');
  return { ok: true };
}

export async function deleteAllReviewDataAction(projectId: string) {
  const userId = await requireUser();
  if (!userId || !(await ownsProject(projectId, userId))) return { error: 'Unauthorized' };
  const [reviews, tickets] = await prisma.$transaction([
    prisma.projectReview.deleteMany({ where: { projectId } }),
    prisma.projectSupportTicket.deleteMany({ where: { projectId } }),
    prisma.projectIssue.deleteMany({ where: { projectId } }),
  ]);
  revalidatePath('/app/projects');
  return { ok: true as const, reviews: reviews.count, tickets: tickets.count };
}

export async function resolveTicketAction(ticketId: string) {
  const userId = await requireUser();
  if (!userId) return { error: 'Unauthorized' };
  const { count } = await prisma.projectSupportTicket.updateMany({
    where: { id: ticketId, project: projectAccessWhere(userId) },
    data: { status: 'RESOLVED' },
  });
  if (!count) return { error: 'Not found.' };
  revalidatePath('/app/projects');
  return { ok: true };
}
