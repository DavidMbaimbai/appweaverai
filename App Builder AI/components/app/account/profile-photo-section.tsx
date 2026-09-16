'use client';

import { Avatar } from '@/components/ui/avatar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
  removeAccountAvatarAction,
  uploadAccountAvatarAction,
} from '@/lib/actions/account';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

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
  const [confirmOpen, setConfirmOpen] = useState(false);

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

      setConfirmOpen(false);
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
            {isPending ? 'Uploading...' : image ? 'Change photo' : 'Upload photo'}
          </button>
          {image ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={isPending}
              className="flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50">
              <TrashIcon className="h-3.5 w-3.5 shrink-0" />
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleRemove}
        title="Remove profile photo?"
        description="Your profile photo will be deleted. You can upload a new one anytime."
        confirmLabel="Remove photo"
        variant="destructive"
        isPending={isPending}
      />
    </section>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true">
      <path
        d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m2 0v11.5A1.5 1.5 0 0 1 15.5 20h-7A1.5 1.5 0 0 1 7 18.5V7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
