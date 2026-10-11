import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, sendEmail } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock('../prisma', () => ({ prisma: { project: { findUnique } } }));
vi.mock('../email', () => ({ sendEmail }));

import { buildSubmissionEmail, notifyFormSubmission } from './notify-submission';

describe('notifyFormSubmission recipient', () => {
  beforeEach(() => {
    findUnique.mockReset();
    sendEmail.mockReset();
  });

  const base = {
    name: 'Shop',
    createdBy: { email: 'owner@x.com' },
    workspace: { owner: { email: 'ws@x.com' } },
  };

  it('prefers the per-project notification email', async () => {
    findUnique.mockResolvedValue({ ...base, notificationEmail: 'leads@x.com' });
    await notifyFormSubmission({ projectId: 'p', formName: 'f', data: {} });
    expect(sendEmail.mock.calls[0][0].to).toBe('leads@x.com');
  });

  it('falls back to the account email', async () => {
    findUnique.mockResolvedValue({ ...base, notificationEmail: null });
    await notifyFormSubmission({ projectId: 'p', formName: 'f', data: {} });
    expect(sendEmail.mock.calls[0][0].to).toBe('owner@x.com');
  });
});

describe('buildSubmissionEmail', () => {
  it('includes fields and escapes HTML', () => {
    const { subject, html, text } = buildSubmissionEmail({
      projectName: 'Shop',
      formName: 'contact',
      data: { name: 'Ann', message: '<script>alert(1)</script>' },
    });

    expect(subject).toBe('New "contact" submission on Shop');
    expect(text).toContain('name: Ann');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
