import { cache } from 'react';

import { prisma } from '@/lib/prisma';
import type { AppUserSettings } from '@/lib/types/settings';
import { defaultWorkspaceSlugFromUser } from '@/lib/workspace-slug';

const settingsSelect = {
  defaultStartPage: true,
  showShortcuts: true,
} as const;

async function findOrCreateUserSettings(userId: string) {
  const existing = await prisma.userSettings.findUnique({
    where: { userId },
    select: settingsSelect,
  });

  if (existing) return existing;

  return prisma.userSettings.create({
    data: { userId },
    select: settingsSelect,
  });
}

export const getUserSettings = cache(async function getUserSettings(
  userId: string,
): Promise<AppUserSettings | null> {
  if (!process.env.DATABASE_URL) return null;

  const [settings, workspace, user] = await Promise.all([
    findOrCreateUserSettings(userId),
    prisma.workspace.findFirst({
      where: { ownerId: userId, type: 'PERSONAL' },
      select: { slug: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, name: true },
    }),
  ]);

  const workspaceSlug =
    workspace?.slug ??
    (user ? defaultWorkspaceSlugFromUser(user) : 'workspace');

  return {
    ...settings,
    workspaceSlug,
  };
});
