'use server';

import { revalidatePath } from 'next/cache';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { requireUserId } from '@/lib/auth/require-user';
import { slugifyUsername } from '@/lib/app-utils';
import { prisma } from '@/lib/prisma';

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export async function updateAccountFieldAction(
  field: 'name' | 'username',
  value: string,
) {
  const authResult = await requireUserId();
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error };
  }

  const trimmed = value.trim();

  if (field === 'name') {
    if (!trimmed) {
      return { error: 'Name cannot be empty.' };
    }

    if (trimmed.length > 80) {
      return { error: 'Name must be 80 characters or fewer.' };
    }

    const user = await prisma.user.update({
      where: { id: authResult.userId },
      data: { name: trimmed },
      select: { name: true },
    });

    revalidatePath('/app/account');

    return { success: true, value: user.name };
  }

  const normalized = slugifyUsername(trimmed.replace(/^@/, ''));

  if (!normalized || normalized.length < 3) {
    return { error: 'Username must be at least 3 characters.' };
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    return {
      error:
        'Use lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.',
    };
  }

  const existing = await prisma.user.findUnique({
    where: { username: normalized },
    select: { id: true },
  });

  if (existing && existing.id !== authResult.userId) {
    return { error: 'That username is already taken.' };
  }

  const user = await prisma.user.update({
    where: { id: authResult.userId },
    data: { username: normalized },
    select: { username: true },
  });

  revalidatePath('/app/account');

  return { success: true, value: user.username };
}

export async function uploadAccountAvatarAction(formData: FormData) {
  const authResult = await requireUserId();
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error };
  }

  const file = formData.get('avatar');

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.' };
  }

  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    return { error: 'Upload a JPG, PNG, WebP, or GIF image.' };
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return { error: 'Image must be 2 MB or smaller.' };
  }

  const extension =
    file.type === 'image/jpeg'
      ? 'jpg'
      : file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : 'gif';

  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'avatars');
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${authResult.userId}.${extension}`;
  const filepath = path.join(uploadsDir, filename);
  const bytes = Buffer.from(await file.arrayBuffer());

  await writeFile(filepath, bytes);

  const imageUrl = `/uploads/avatars/${filename}?v=${Date.now()}`;

  await prisma.user.update({
    where: { id: authResult.userId },
    data: { image: imageUrl },
  });

  revalidatePath('/app/account');

  return { success: true, value: imageUrl };
}

export async function removeAccountAvatarAction() {
  const authResult = await requireUserId();
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error };
  }

  await prisma.user.update({
    where: { id: authResult.userId },
    data: { image: null },
  });

  revalidatePath('/app/account');

  return { success: true, value: null };
}
