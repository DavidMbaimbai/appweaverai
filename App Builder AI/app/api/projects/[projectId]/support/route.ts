import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { findPublicProject, json, limited, CORS_HEADERS } from '@/lib/project-reviews/public-api';
import {
  answerFromKnowledge,
  NOT_KNOWN_MESSAGE,
  SUPPORT_DAILY_CAP,
} from '@/lib/project-reviews/support';

type Ctx = { params: Promise<{ projectId: string }> };

const schema = z.object({
  question: z.string().trim().min(2).max(600),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1500) }))
    .max(12)
    .optional(),
  // Set when the visitor accepted the offer to create a ticket.
  createTicket: z.boolean().optional(),
  contact: z.string().trim().max(200).optional(),
});

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Public support assistant: answers only from ProjectKnowledge; never reads customer records. */
export async function POST(request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const limit = await limited(request, 'support', projectId, 12, 60_000);
  if (limit) return limit;

  if (!(await findPublicProject(projectId))) return json({ error: 'Project not found.' }, 404);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Invalid question.' }, 400);
  const { question, history, createTicket, contact } = parsed.data;

  if (createTicket) {
    const ticketLimit = await limited(request, 'support-ticket', projectId, 3, 60 * 60_000);
    if (ticketLimit) return ticketLimit;
    await prisma.projectSupportTicket.create({
      data: {
        projectId,
        question,
        contact: contact || null,
        transcript: history ?? [],
      },
    });
    return json({ answer: "Thanks — I've passed your question to the team.", ticketCreated: true });
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const used = await prisma.aiUsageEvent.count({
    where: { projectId, provider: 'project-support', createdAt: { gte: startOfDay } },
  });
  if (used >= SUPPORT_DAILY_CAP) {
    return json({ answer: NOT_KNOWN_MESSAGE, offerTicket: true });
  }

  const docs = await prisma.projectKnowledge.findMany({
    where: { projectId },
    take: 200,
    select: { id: true, title: true, content: true },
  });

  let answer: string | null = null;
  try {
    answer = await answerFromKnowledge(projectId, question, docs);
  } catch (error) {
    console.error('Support assistant failed:', error);
  }
  if (!answer) return json({ answer: NOT_KNOWN_MESSAGE, offerTicket: true });
  return json({ answer, offerTicket: false });
}
