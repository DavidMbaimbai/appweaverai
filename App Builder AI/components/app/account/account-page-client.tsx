'use client';

import { Input } from '@/components/ui/input';
import { updateAccountFieldAction } from '@/lib/actions/account';
import { useRouter } from 'next/navigation';
import type { AccountProfile } from '@/lib/types/account';
import { ConnectedAccountSection } from './connected-accounts-section';
import { ProfilePhotoSection } from './profile-photo-section';
import { InlineEditField } from './inline-edit-field';

type AccountPageClientProps = {
  profile: AccountProfile;
};

function formatMemberSince(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

export function AccountPageClient({ profile }: AccountPageClientProps) {
  const router = useRouter();

  async function saveField(field: 'name' | 'username', value: string) {
    const result = await updateAccountFieldAction(field, value);

    if (result.error) {
      return { error: result.error };
    }

    router.refresh();
    return { value: result.value ?? value };
  }

  return (
    <div className="w-full px-6 py-8 tablet-up:px-8">
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl text-app-text">Account</h1>
          <p className="mt-1 text-sm text-app-text-muted">
            Manage your profile and connected sign-in providers.
          </p>
        </div>

        <ProfilePhotoSection
          name={profile.name}
          email={profile.email}
          image={profile.image}
        />

        <section className="rounded-2xl border border-app-border bg-app-surface px-6">
          <div className="border-b border-app-border-subtle py-5">
            <h2 className="font-display text-lg text-app-text">Profile</h2>
            <p className="mt-1 text-sm text-app-text-muted">
              Edit your details inline. Changes save when you leave a field.
            </p>
          </div>

          <InlineEditField
            id="account-name"
            label="Display name"
            value={profile.name ?? ''}
            placeholder="Your name"
            onSave={(value) => saveField('name', value)}
          />

          <InlineEditField
            id="account-username"
            label="Username"
            value={profile.username ?? ''}
            placeholder="your-username"
            prefix="@"
            hint="Used in your public profile."
            onSave={(value) => saveField('username', value)}
          />

          <div className="grid gap-2 border-b border-app-border-subtle py-4 last:border-b-0 tablet-up:grid-cols-2 tablet-up:items-start tablet-up:gap-6">
            <div className="min-w-0 space-y-1">
              <label
                htmlFor="account-email"
                className="text-sm font-medium text-app-text">
                Email
              </label>
              <p className="text-xs text-app-text-muted">
                Managed by your sign-in provider.
              </p>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Input
                id="account-email"
                value={profile.email ?? ''}
                disabled
                theme="app"
                className="opacity-80"
              />
              <p className="text-xs text-app-text-muted">
                {profile.emailVerified ? 'Verified' : 'Not verified'}
              </p>
            </div>
          </div>
        </section>

        <ConnectedAccountSection accounts={profile.connectedAccounts} />

        <section className="rounded-2xl border border-app-border bg-app-surface p-6">
          <h2 className="font-display text-lg text-app-text">Account info</h2>
          <dl className="mt-4 grid gap-4 text-sm tablet-up:grid-cols-2">
            <div>
              <dt className="text-app-text-muted">Member since</dt>
              <dd className="mt-1 font-medium text-app-text">
                {formatMemberSince(profile.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-app-text-muted">User ID</dt>
              <dd className="mt-1 break-all font-mono text-xs text-app-text-secondary">
                {profile.id}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
