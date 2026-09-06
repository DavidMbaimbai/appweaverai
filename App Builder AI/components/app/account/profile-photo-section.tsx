'use client';

import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import {
  removeAccountAvatarAction,
  uploadAccountAvatarAction,
} from '@/lib/actions/account';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useRef, useTransition } from 'react';

type ProfilePhotoSectionProps = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export function ProfilePhotoSection({
  name,
  email,
  image,
}: ProfilePhotoSectionProps) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    startTransition(async () => {
      const result = await uploadAccountAvatarAction(formData);

      if (result.error) {
        toastError(result.error);
        return;
      }

      success('Profile photo updated');
      router.refresh();
    });

    event.target.value = '';
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeAccountAvatarAction();

      if (result.error) {
        toastError(result.error);
        return;
      }

      success('Profile photo removed');
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-app-border bg-app-surface p-6">
      <div className="flex flex-col gap-5 mobile:items-start tablet-up:flex-row tablet-up:items-center tablet-up:justify-between">
        <div className="flex items-center gap-4">
          <Avatar
            name={name ?? email}
            image={image}
            size="lg"
            theme="app"
            className="h-16 w-16 text-lg"
          />
          <div>
            <h2 className="font-display text-lg text-app-text">
              Profile photo
            </h2>
            <p className="mt-1 text-sm text-app-text-muted">
              JPG, PNG, WebP, or GIF. Max 2 MB.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
            aria-label="Upload profile photo"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isPending}
            className={cn(
              'h-9 rounded-lg border border-app-border bg-app-input-bg px-4 text-sm text-app-text transition-colors',
              'hover:bg-app-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
            )}>
            {isPending ? 'Uploading...' : 'Change photo'}
          </button>
          {image ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isPending}
              className="h-9 rounded-lg px-4 text-sm text-app-text-muted transition-colors hover:bg-app-surface-hover hover:text-app-text disabled:opacity-50">
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
