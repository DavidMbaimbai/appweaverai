import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { BuyButton, InstallPanel, ReportForm, ReviewForm } from '@/components/marketplace/asset-actions';
import { priceLabel } from '@/components/marketplace/browse-view';
import { Container } from '@/components/ui/container';
import { getCachedSession } from '@/lib/auth/cached';
import { getMarketingNavUser } from '@/lib/auth/nav-user';
import { getPublishedAsset, getViewerState } from '@/lib/marketplace/catalog';
import { salesState, takedownContact } from '@/lib/marketplace/config';
import { reviewEligibility } from '@/lib/marketplace/rules';
import { LICENSES, TYPE_LABELS, TYPE_SEGMENTS, typeFromSegment } from '@/lib/marketplace/types';

type Params = Promise<{ type: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const asset = await getPublishedAsset(slug);
  if (!asset) return { title: 'Marketplace | AppWeaver AI', robots: { index: false } };
  return {
    title: `${asset.title} | AppWeaver Marketplace`,
    description: asset.summary,
    alternates: { canonical: `/marketplace/${TYPE_SEGMENTS[asset.type]}/${asset.slug}` },
  };
}

export default async function AssetPage({ params }: { params: Params }) {
  const { type, slug } = await params;
  const asset = await getPublishedAsset(slug);
  if (!asset || !typeFromSegment(type)) notFound();
  const canonical = TYPE_SEGMENTS[asset.type];
  if (type !== canonical) redirect(`/marketplace/${canonical}/${asset.slug}`);

  const [initialUser, session] = await Promise.all([getMarketingNavUser(), getCachedSession()]);
  const userId = session?.user?.id;
  const viewer = userId ? await getViewerState(userId, asset.id) : null;
  const paid = asset.priceCents > 0;
  const sales = salesState();
  const license = LICENSES[asset.license];
  const contact = takedownContact();
  const canReview = viewer ? reviewEligibility({ ...viewer, assetStatus: 'PUBLISHED' }).ok : false;
  const owned = Boolean(viewer && (viewer.isCreator || viewer.hasPaidOrder));

  let locked: string | null = null;
  if (!userId) locked = 'Sign in to install this asset.';
  else if (paid && !owned) locked = 'Purchase this asset to install it.';

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16">
        <Container>
          <p className="text-sm opacity-70">
            <Link href="/marketplace">Marketplace</Link> / <Link href={`/marketplace/${canonical}`}>{TYPE_LABELS[asset.type]}</Link>
          </p>
          <h1 className="mt-2 text-3xl font-semibold">{asset.title}</h1>
          <p className="mt-1 text-sm opacity-70">
            by {asset.creatorName} · version {asset.currentVersion} · {priceLabel(asset.priceCents, asset.currency)}
          </p>
          <p className="mt-4 max-w-2xl whitespace-pre-line text-sm opacity-90">{asset.description}</p>
          <p className="mt-3 text-xs opacity-70">
            {asset.installCount} install{asset.installCount === 1 ? '' : 's'} ·{' '}
            {asset.reviewCount > 0 && asset.averageRating !== null
              ? `${asset.averageRating.toFixed(1)}/5 from ${asset.reviewCount} review${asset.reviewCount === 1 ? '' : 's'}`
              : 'No reviews yet'}{' '}
            · Safety scan: {asset.scanVerdict}
          </p>

          <section className="mt-8 max-w-xl space-y-3">
            {paid && !owned ? (
              userId ? (
                sales.enabled ? (
                  <BuyButton slug={asset.slug} label={`Buy for ${priceLabel(asset.priceCents, asset.currency)}`} />
                ) : (
                  <p className="text-sm text-amber-300">{sales.reason}</p>
                )
              ) : null
            ) : null}
            <InstallPanel slug={asset.slug} locked={locked} />
            {!userId ? (
              <Link className="text-sm underline" href={`/login?callbackUrl=${encodeURIComponent(`/marketplace/${canonical}/${asset.slug}`)}`}>
                Sign in
              </Link>
            ) : null}
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-medium">License</h2>
            <p className="mt-1 text-sm opacity-80">
              {license ? `${license.label}: ${license.summary}` : asset.license}
              {license?.url ? (
                <>
                  {' '}
                  <a className="underline" href={license.url} rel="noopener noreferrer" target="_blank">
                    Full text
                  </a>
                </>
              ) : null}
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-medium">Included files ({asset.files.length})</h2>
            <ul className="mt-3 space-y-3">
              {asset.files.map((f) => (
                <li key={f.path} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    <code>{f.path}</code> <span className="opacity-60">({f.bytes} bytes)</span>
                  </p>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs opacity-80">{f.preview}</pre>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-medium">Versions</h2>
            <ul className="mt-2 text-sm opacity-80">
              {asset.versions.map((v) => (
                <li key={v.version}>
                  v{v.version} · {v.fileCount} files{v.changelog ? ` · ${v.changelog}` : ''}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10 max-w-xl">
            <h2 className="text-lg font-medium">Reviews</h2>
            {asset.reviews.length === 0 ? <p className="mt-2 text-sm opacity-70">No reviews yet.</p> : null}
            <ul className="mt-2 space-y-3">
              {asset.reviews.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="font-medium">{r.rating}/5</span> <span className="opacity-80">{r.body}</span>
                </li>
              ))}
            </ul>
            {canReview ? (
              <div className="mt-4">
                <ReviewForm slug={asset.slug} />
              </div>
            ) : null}
          </section>

          <section className="mt-10 max-w-xl space-y-2">
            {userId ? <ReportForm slug={asset.slug} /> : null}
            <p className="text-xs opacity-60">
              Copyright or safety concern? {contact ? <>Contact <a className="underline" href={`mailto:${contact}`}>{contact}</a>.</> : 'A takedown contact has not been configured yet; sign in and use the report form.'}
            </p>
          </section>
        </Container>
      </main>
      <Footer />
    </>
  );
}
