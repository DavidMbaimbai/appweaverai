import Link from 'next/link';

import { AcceptInvitationButton } from '@/components/app/team/accept-invitation-button';
import { getCachedSession } from '@/lib/auth/cached';
import { previewInvitation } from '@/lib/team/invitations';
import { ROLE_LABELS } from '@/lib/team/permissions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

export default async function InvitePage({ params }: Props) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const session = await getCachedSession();
  const preview = process.env.DATABASE_URL ? await previewInvitation(token) : null;

  return (
    <main className="mx-auto max-w-md space-y-4 p-8">
      {!preview ? (
        <>
          <h1 className="text-xl font-semibold">Invitation unavailable</h1>
          <p className="text-sm text-app-text-muted">This invitation link is invalid, expired or was revoked. Ask your teammate to send a new one.</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Join {preview.projectName ?? preview.workspaceName}</h1>
          <p className="text-sm text-app-text-muted">
            You were invited as <strong>{ROLE_LABELS[preview.role]}</strong>. This invitation is for {preview.email}.
          </p>
          {session?.user?.id ? (
            <AcceptInvitationButton token={token} />
          ) : (
            <p className="text-sm">
              <Link className="underline" href="/">Sign in</Link> with {preview.email}, then reopen this link.
            </p>
          )}
        </>
      )}
    </main>
  );
}
