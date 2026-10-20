import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BrowseView, type BrowseSearch } from '@/components/marketplace/browse-view';
import { TYPE_LABELS, typeFromSegment } from '@/lib/marketplace/types';

type Params = Promise<{ type: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const type = typeFromSegment((await params).type);
  if (!type) return {};
  return {
    title: `${TYPE_LABELS[type]} | AppWeaver Marketplace`,
    description: `Browse ${TYPE_LABELS[type].toLowerCase()} for your AppWeaver projects.`,
    alternates: { canonical: `/marketplace/${(await params).type}` },
  };
}

export default async function MarketplaceTypePage({ params, searchParams }: { params: Params; searchParams: Promise<BrowseSearch> }) {
  const type = typeFromSegment((await params).type);
  if (!type) notFound();
  return <BrowseView type={type} search={await searchParams} />;
}
