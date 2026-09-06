'use server';

import { revalidatePath } from 'next/cache';

import { requireUserId } from '@/lib/auth/require-user';
import type { DefaultStartPage } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import {
  normalizeWorkspaceSlug,
  uniqueWorkspaceSlug,
  validateWorkspaceSlug,
} from '@/lib/workspace-slug';

type SettingsUpdate = {
  defaultStartPage?: DefaultStartPage;
  showShortcuts?: boolean;
};

export async function updateUserSettingsAction(data: SettingsUpdate) {
  const authResult = await requireUserId();
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error };
  }

  await prisma.userSettings.upsert({
    where: { userId: authResult.userId },
    create: { userId: authResult.userId, ...data },
    update: data,
  });

  revalidatePath('/app/settings');

  return { success: true };
}

export async function updateWorkspaceSlugAction(value: string) {
  const authResult = await requireUserId();
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error };
  }

  const normalized = normalizeWorkspaceSlug(value.trim());
  const validationError = validateWorkspaceSlug(normalized);
  if (validationError) {
    return { error: validationError };
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      ownerId: authResult.userId,
      type: 'PERSONAL',
    },
    select: { id: true, slug: true },
  });

  if (!workspace) {
    return { error: 'Personal workspace not found.' };
  }

  if (workspace.slug === normalized) {
    return { success: true, value: normalized };
  }

  const nextSlug = await uniqueWorkspaceSlug(normalized, workspace.id);

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { slug: nextSlug },
    select: { slug: true },
  });

  revalidatePath('/app/settings');
  revalidatePath('/app/projects');

  return { success: true, value: nextSlug };
}
