import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

import { NOTIFICATION_KINDS, NOTIFICATION_LABELS, type NotificationKind } from './notification-kinds';

export { NOTIFICATION_KINDS, NOTIFICATION_LABELS, type NotificationKind };

export type NotifyInput = {
  userId: string;
  actorId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  projectId?: string | null;
};

/** Pure: which channels a preference row allows (default is both on). */
export function channelsFor(pref: { inApp: boolean; email: boolean } | null | undefined) {
  return { inApp: pref?.inApp ?? true, email: pref?.email ?? true };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Creates an in-app notification and/or an email according to the recipient's preferences.
 * Never notifies the person who caused the event. Best-effort: failures are logged, never thrown.
 */
export async function notifyUser(input: NotifyInput): Promise<void> {
  if (input.actorId && input.actorId === input.userId) return;
  try {
    const [pref, user, settings] = await Promise.all([
      prisma.notificationPreference.findUnique({ where: { userId_kind: { userId: input.userId, kind: input.kind } } }),
      prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } }),
      prisma.userSettings.findUnique({ where: { userId: input.userId }, select: { emailNotifications: true } }),
    ]);
    if (!user) return;
    const channels = channelsFor(pref);
    if (channels.inApp) {
      await prisma.userNotification.create({
        data: {
          userId: input.userId,
          projectId: input.projectId ?? null,
          kind: input.kind,
          title: input.title.slice(0, 200),
          body: input.body?.slice(0, 1000) ?? null,
          href: input.href ?? null,
        },
      });
    }
    if (channels.email && user.email && (settings?.emailNotifications ?? true)) {
      const link = input.href ? `\n\n${input.href}` : '';
      await sendEmail({
        to: user.email,
        subject: input.title,
        text: `${input.body ?? input.title}${link}`,
        html: `<p>${escapeHtml(input.body ?? input.title)}</p>${input.href ? `<p><a href="${escapeHtml(input.href)}">Open</a></p>` : ''}`,
      });
    }
  } catch (error) {
    console.error('[team] notification failed:', error);
  }
}

export async function listNotifications(userId: string, { limit = 30 }: { limit?: number } = {}) {
  const [items, unread] = await Promise.all([
    prisma.userNotification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 100) }),
    prisma.userNotification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  const result = await prisma.userNotification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function getNotificationPreferences(userId: string) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId } });
  return NOTIFICATION_KINDS.map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    return { kind, label: NOTIFICATION_LABELS[kind], ...channelsFor(row) };
  });
}

export async function setNotificationPreference(
  userId: string,
  kind: NotificationKind,
  value: { inApp: boolean; email: boolean },
) {
  await prisma.notificationPreference.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, ...value },
    update: value,
  });
}
