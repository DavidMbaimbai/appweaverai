import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { sendEmail } from '@/lib/email';
import { renderBrandedEmail } from '@/lib/email-templates';
import { prisma } from '@/lib/prisma';

import { RELEASE_PLATFORM_LABELS, isReleasePlatform } from './capabilities';

export type NotifyKind = 'published' | 'failed' | 'expired-token' | 'approval-reminder' | 'manual';

type NotifyRelease = {
  userId: string;
  platform: string;
  title: string;
  scheduledAt: Date;
  timeZone: string;
  postUrl?: string | null;
  error?: string | null;
  note?: string | null;
};

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function formatLocal(date: Date, timeZone: string) {
  try {
    return `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date)} (${timeZone})`;
  } catch {
    return `${date.toISOString()} (UTC)`;
  }
}

export function buildMessage(kind: NotifyKind, release: NotifyRelease) {
  const platform = isReleasePlatform(release.platform) ? RELEASE_PLATFORM_LABELS[release.platform] : release.platform;
  const title = escape(release.title);
  const when = escape(formatLocal(release.scheduledAt, release.timeZone));
  const detail = release.error ? `<p>${escape(release.error)}</p>` : '';
  switch (kind) {
    case 'published':
      return {
        subject: `Published on ${platform}: ${release.title}`,
        heading: 'Your video is live',
        body: `<p><strong>${title}</strong> was published to ${platform}, confirmed by the platform.</p>${
          release.postUrl ? `<p><a href="${escape(release.postUrl)}">Open the post</a></p>` : ''
        }${release.note ? `<p>${escape(release.note)}</p>` : ''}`,
      };
    case 'failed':
      return {
        subject: `Could not publish to ${platform}: ${release.title}`,
        heading: 'A scheduled video was not published',
        body: `<p><strong>${title}</strong> (${platform}, ${when}) was NOT published.</p>${detail}<p>Open the scheduler to retry or reschedule it.</p>`,
      };
    case 'expired-token':
      return {
        subject: `Reconnect ${platform} to publish: ${release.title}`,
        heading: `Your ${platform} connection expired`,
        body: `<p><strong>${title}</strong> (${when}) could not be published because the ${platform} connection expired or was revoked. Reconnect it, or download the video and post it yourself.</p>`,
      };
    case 'manual':
      return {
        subject: `Post manually to ${platform}: ${release.title}`,
        heading: 'This video needs a manual post',
        body: `<p><strong>${title}</strong> (${when}) cannot be published automatically to ${platform}.</p>${detail}<p>Download the video from the scheduler and post it yourself.</p>`,
      };
    case 'approval-reminder':
      return {
        subject: `Approve your ${platform} video before it is due: ${release.title}`,
        heading: 'Approval needed within 24 hours',
        body: `<p><strong>${title}</strong> is scheduled for ${when} on ${platform} but is <strong>not approved yet</strong>. Unapproved videos are never published. Approve it in the scheduler to release it on time.</p>`,
      };
  }
}

/** Best-effort email to the owner; never throws, since a mail problem must not undo a publish. */
export async function notifyOwner(kind: NotifyKind, release: NotifyRelease): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id: release.userId }, select: { email: true } });
    if (!user?.email) return false;
    const message = buildMessage(kind, release);
    await sendEmail({
      to: user.email,
      subject: message.subject,
      html: renderBrandedEmail({
        heading: message.heading,
        bodyHtml: message.body,
        ctaLabel: 'Open scheduler',
        ctaUrl: `${appBaseUrl()}/app/studio/video/schedule`,
      }),
    });
    return true;
  } catch (error) {
    console.error('[video-release] notification failed:', error);
    return false;
  }
}
