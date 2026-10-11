import { sendEmail } from '../email';
import { prisma } from '../prisma';

const MAX_FIELDS = 30;
const MAX_VALUE_CHARS = 2_000;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stringify(value: unknown) {
  const text =
    typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return text.slice(0, MAX_VALUE_CHARS);
}

export function buildSubmissionEmail(input: {
  projectName: string;
  formName: string;
  data: Record<string, unknown>;
}) {
  const fields = Object.entries(input.data)
    .slice(0, MAX_FIELDS)
    .map(([key, value]) => [key.slice(0, 80), stringify(value)] as const);

  const subject = `New "${input.formName}" submission on ${input.projectName}`;
  const text = [
    `Someone submitted the "${input.formName}" form on ${input.projectName}.`,
    '',
    ...fields.map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
  const html = [
    `<p>Someone submitted the <strong>${escapeHtml(input.formName)}</strong> form on <strong>${escapeHtml(input.projectName)}</strong>.</p>`,
    '<table cellpadding="6" style="border-collapse:collapse">',
    ...fields.map(
      ([k, v]) =>
        `<tr><td style="font-weight:600;vertical-align:top">${escapeHtml(k)}</td><td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`,
    ),
    '</table>',
    '<p style="color:#6b7280;font-size:12px">You can also view all submissions in the Forms panel of your project.</p>',
  ].join('');

  return { subject, text, html };
}

/** Emails the project owner about a new form submission. Never throws. */
export async function notifyFormSubmission(input: {
  projectId: string;
  formName: string;
  data: Record<string, unknown>;
}) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        name: true,
        notificationEmail: true,
        createdBy: { select: { email: true } },
        workspace: { select: { owner: { select: { email: true } } } },
      },
    });
    const to =
      project?.notificationEmail ??
      project?.createdBy?.email ??
      project?.workspace?.owner?.email;
    if (!project || !to) return;

    await sendEmail({
      to,
      ...buildSubmissionEmail({
        projectName: project.name,
        formName: input.formName,
        data: input.data,
      }),
    });
  } catch (error) {
    console.error('Form notification failed:', error);
  }
}
