import { createHash } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import {
  createFormSubmission,
  FormSubmissionError,
} from '@/lib/forms/project-form-submissions';
import { notifyFormSubmission } from '@/lib/forms/notify-submission';
import { clientIp, limitOrResponse } from '@/lib/rate-limit';

const submitSchema = z.object({
  formName: z.string().trim().min(1).max(80).optional(),
  data: z.record(z.string(), z.unknown()),
});

/**
 * Public, unauthenticated endpoint that the injected form-submit shim
 * (lib/preview/form-submit-shim.ts) posts to from inside the preview/live
 * iframe. Only accepts submissions for projects that are not deleted or
 * suspended, mirroring the visibility checks on the published-site path.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;

  const limited = await limitOrResponse(
    `form:${projectId}:${clientIp(request)}`,
    10,
    60_000,
  );
  if (limited) return limited;

  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, adminStatus: 'ACTIVE' },
    select: { id: true },
  });
  if (!project) {
    return Response.json({ error: 'Project not found.' }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = submitSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid form submission.' }, { status: 400 });
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip');
  const userAgent = request.headers.get('user-agent');
  const day = new Date().toISOString().slice(0, 10);
  const visitorId = createHash('sha256')
    .update(`${day}:${projectId}:${ip ?? 'unknown'}:${userAgent ?? 'unknown'}`)
    .digest('hex')
    .slice(0, 40);

  try {
    const submission = await createFormSubmission({
      projectId,
      formName: parsed.data.formName ?? 'contact',
      data: parsed.data.data,
      visitorId,
    });
    await notifyFormSubmission({
      projectId,
      formName: parsed.data.formName ?? 'contact',
      data: parsed.data.data,
    });
    return Response.json({ success: true, id: submission.id });
  } catch (error) {
    if (error instanceof FormSubmissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: 'Could not submit this form right now.' },
      { status: 500 },
    );
  }
}
