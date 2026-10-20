import Link from 'next/link';

import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { Container } from '@/components/ui/container';
import { getMarketingNavUser } from '@/lib/auth/nav-user';
import { browseAssets, SORTS, type Sort } from '@/lib/marketplace/catalog';
import { ASSET_TYPES, TYPE_LABELS, TYPE_SEGMENTS, type AssetType } from '@/lib/marketplace/types';

export type BrowseSearch = { q?: string; tag?: string; price?: string; sort?: string; page?: string };

export function priceLabel(priceCents: number, currency: string) {
  if (priceCents === 0) return 'Free';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(priceCents / 100);
}

export async function BrowseView({ type, search }: { type?: AssetType; search: BrowseSearch }) {
  const initialUser = await getMarketingNavUser();
  const sort = SORTS.includes(search.sort as Sort) ? (search.sort as Sort) : 'newest';
  const price = search.price === 'free' || search.price === 'paid' ? search.price : undefined;
  const page = Math.max(1, Number(search.page) || 1);
  const result = await browseAssets({ q: search.q, tag: search.tag, type, price, sort, page });
  const base = type ? `/marketplace/${TYPE_SEGMENTS[type]}` : '/marketplace';
  const qs = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q: search.q, tag: search.tag, price, sort, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `?${s}` : '';
  };
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <Navbar initialUser={initialUser} />
      <main className="min-h-[60vh] py-16">
        <Container>
          <h1 className="text-3xl font-semibold">{type ? TYPE_LABELS[type] : 'Marketplace'}</h1>
          <p className="mt-2 max-w-2xl text-sm opacity-80">
            Templates, components, integration guides, agent workflows and starter kits you can install into your projects.
          </p>
          <nav className="mt-6 flex flex-wrap gap-2 text-sm">
            <Link className="rounded-full border px-3 py-1" href="/marketplace">
              All
            </Link>
            {ASSET_TYPES.map((t) => (
              <Link key={t} className="rounded-full border px-3 py-1" href={`/marketplace/${TYPE_SEGMENTS[t]}`}>
                {TYPE_LABELS[t]}
              </Link>
            ))}
            <Link className="ml-auto rounded-full border px-3 py-1" href="/marketplace/creator">
              Sell or publish
            </Link>
          </nav>
          <form className="mt-4 flex flex-wrap gap-2 text-sm" action={base}>
            <input name="q" defaultValue={search.q} placeholder="Search" className="rounded-lg border bg-transparent px-3 py-2" />
            <select name="price" defaultValue={price ?? ''} className="rounded-lg border bg-transparent px-3 py-2">
              <option value="">Any price</option>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
            </select>
            <select name="sort" defaultValue={sort} className="rounded-lg border bg-transparent px-3 py-2">
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
            <button className="rounded-lg border px-3 py-2" type="submit">
              Apply
            </button>
          </form>

          {result.items.length === 0 ? (
            <p className="mt-10 text-sm opacity-80">Nothing here yet.</p>
          ) : (
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.items.map((a) => (
                <li key={a.id} className="rounded-xl border p-4">
                  <Link href={`/marketplace/${TYPE_SEGMENTS[a.type]}/${a.slug}`} className="text-lg font-medium hover:underline">
                    {a.title}
                  </Link>
                  <p className="mt-1 text-xs opacity-70">
                    {TYPE_LABELS[a.type]} · by {a.creatorName} · {a.license}
                  </p>
                  <p className="mt-2 text-sm opacity-80">{a.summary}</p>
                  <p className="mt-3 text-xs opacity-70">
                    {priceLabel(a.priceCents, a.currency)} · {a.installCount} install{a.installCount === 1 ? '' : 's'}
                    {a.reviewCount > 0 && a.averageRating !== null
                      ? ` · ${a.averageRating.toFixed(1)}/5 (${a.reviewCount} review${a.reviewCount === 1 ? '' : 's'})`
                      : ' · No reviews yet'}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {lastPage > 1 ? (
            <div className="mt-8 flex gap-3 text-sm">
              {page > 1 ? <Link href={`${base}${qs({ page: String(page - 1) })}`}>Previous</Link> : null}
              <span>
                Page {page} of {lastPage}
              </span>
              {page < lastPage ? <Link href={`${base}${qs({ page: String(page + 1) })}`}>Next</Link> : null}
            </div>
          ) : null}
        </Container>
      </main>
      <Footer />
    </>
  );
}
