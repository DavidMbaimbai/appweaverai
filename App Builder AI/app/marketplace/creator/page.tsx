import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { BecomeCreatorForm, SubmitAssetForm } from '@/components/marketplace/creator-forms';
import { Container } from '@/components/ui/container';
import { getCachedSession } from '@/lib/auth/cached';
import { getMarketingNavUser } from '@/lib/auth/nav-user';
import { PAYOUTS_BLOCKED_MESSAGE, salesState } from '@/lib/marketplace/config';
import { creatorEarnings } from '@/lib/marketplace/purchase';
import { listCreatorAssets } from '@/lib/marketplace/submit';
import { TYPE_LABELS } from '@/lib/marketplace/types';

export const metadata: Metadata = { title: 'Creator dashboard | AppWeaver Marketplace', robots: { index: false } };

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export default async function CreatorPage() {
  const session = await getCachedSession();
  const userId = session?.user?.id;
  if (!userId) redirect('/login?callbackUrl=/marketplace/creator');
  const [initialUser, data] = await Promise.all([getMarketingNavUser(), listCreatorAssets(userId)]);
  const earnings = data.creator ? await creatorEarnings(data.creator.id) : null;

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16">
        <Container>
          <p className="text-sm opacity-70">
            <Link href="/marketplace">Marketplace</Link> / Creator
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Creator dashboard</h1>
          {!data.creator ? (
            <div className="mt-6">
              <BecomeCreatorForm />
            </div>
          ) : (
            <>
              <section className="mt-6 rounded-xl border p-4 text-sm">
                <p>
                  Earnings recorded: <strong>{money(earnings?.balanceCents ?? 0)}</strong> from {earnings?.orders ?? 0} paid order(s).
                </p>
                <p className="mt-1 text-amber-300">{PAYOUTS_BLOCKED_MESSAGE}</p>
              </section>

              <h2 className="mt-8 text-lg font-medium">Your assets</h2>
              {data.assets.length === 0 ? <p className="mt-2 text-sm opacity-70">Nothing submitted yet.</p> : null}
              <ul className="mt-2 space-y-2 text-sm">
                {data.assets.map((a) => (
                  <li key={a.id} className="rounded-lg border p-3">
                    <strong>{a.title}</strong> · {TYPE_LABELS[a.type]} · {a.status.replace('_', ' ').toLowerCase()} · {a._count.installs} install(s)
                    {a.versions[0]?.reviewNotes ? <p className="mt-1 opacity-80">Moderator note: {a.versions[0].reviewNotes}</p> : null}
                  </li>
                ))}
              </ul>

              <h2 className="mt-8 text-lg font-medium">Submit an asset</h2>
              <div className="mt-3">
                <SubmitAssetForm paidEnabled={salesState().enabled} />
              </div>
            </>
          )}
        </Container>
      </main>
      <Footer />
    </>
  );
}
