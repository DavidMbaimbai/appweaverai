import { prisma } from '@/lib/prisma';
import { CORS_HEADERS, findPublicProject, json, limited } from '@/lib/project-reviews/public-api';
import { isValidVisitorId, parseWebchatInbound } from '@/lib/messaging/adapters/webchat';
import { handleInbound } from '@/lib/messaging/ingest';

type Ctx = { params: Promise<{ projectId: string }> };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function visibleMessages(projectId: string, visitorId: string, after: Date | null) {
  const conversation = await prisma.conversation.findFirst({
    where: { scopeType: 'PROJECT', scopeId: projectId, channel: 'WEBCHAT', externalThreadId: visitorId },
    select: { id: true },
  });
  if (!conversation) return [];
  const rows = await prisma.inboxMessage.findMany({
    where: { conversationId: conversation.id, isDraft: false, ...(after ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true, direction: true, body: true, createdAt: true },
  });
  return rows.map((m) => ({ id: m.id, role: m.direction === 'INBOUND' ? 'visitor' : 'agent', text: m.body, at: m.createdAt.toISOString() }));
}

/** Widget poll: only the visitor's own thread (the visitor id is an unguessable bearer token); drafts are never exposed. */
export async function GET(request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const blocked = await limited(request, 'webchat-poll', projectId, 120, 60_000);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const visitorId = url.searchParams.get('v');
  if (!isValidVisitorId(visitorId)) return json({ error: 'Invalid visitor.' }, 400);
  if (!(await findPublicProject(projectId))) return json({ error: 'Not found.' }, 404);
  const afterParam = url.searchParams.get('after');
  const after = afterParam && !Number.isNaN(Date.parse(afterParam)) ? new Date(afterParam) : null;
  return json({ messages: await visibleMessages(projectId, visitorId, after) });
}

/** Visitor message: stored, then answered by the Customer Engagement agent according to the owner's mode. */
export async function POST(request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const blocked = await limited(request, 'webchat', projectId, 15, 60_000);
  if (blocked) return blocked;
  if (!(await findPublicProject(projectId))) return json({ error: 'Not found.' }, 404);

  const text = await request.text();
  if (text.length > 10_000) return json({ error: 'Message too large.' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid body.' }, 400);
  }

  const inbound = parseWebchatInbound(projectId, body);
  if (!inbound) return json({ error: 'A message and a valid visitor id are required.' }, 400);

  const { ingest, respond } = await handleInbound({ type: 'PROJECT', projectId }, inbound);
  const messages = await visibleMessages(projectId, inbound.externalThreadId, null);
  const replied = respond?.status === 'sent';
  return json({
    duplicate: ingest.duplicate || undefined,
    messages,
    notice: replied ? undefined : 'Thanks for your message. The team will reply here.',
  });
}
