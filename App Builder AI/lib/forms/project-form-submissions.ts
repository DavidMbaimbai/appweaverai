import { prisma } from '../prisma';

const MAX_FIELDS = 30;
const MAX_FIELD_VALUE_LENGTH = 5000;
const MAX_FORM_NAME_LENGTH = 80;

export class FormSubmissionError extends Error {}

/**
 * Persists a public form submission after basic sanity limits (field count,
 * value length) to keep the (unauthenticated) submit endpoint from being
 * used to store arbitrarily large payloads.
 */
export async function createFormSubmission({
  projectId,
  formName,
  data,
  visitorId,
}: {
  projectId: string;
  formName: string;
  data: Record<string, unknown>;
  visitorId?: string | null;
}) {
  const name = formName.trim().slice(0, MAX_FORM_NAME_LENGTH) || 'contact';

  const entries = Object.entries(data).slice(0, MAX_FIELDS);
  if (entries.length === 0) {
    throw new FormSubmissionError('This form has no fields to submit.');
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of entries) {
    sanitized[String(key).slice(0, 200)] = String(value ?? '').slice(
      0,
      MAX_FIELD_VALUE_LENGTH,
    );
  }

  return prisma.projectFormSubmission.create({
    data: {
      projectId,
      formName: name,
      data: sanitized,
      visitorId: visitorId?.slice(0, 200) || null,
    },
    select: { id: true, createdAt: true },
  });
}

export async function listFormSubmissions(
  projectId: string,
  options?: { take?: number },
) {
  return prisma.projectFormSubmission.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: options?.take ?? 100,
    select: {
      id: true,
      formName: true,
      data: true,
      createdAt: true,
    },
  });
}
