import type { Metadata } from 'next';

import { BrowseView, type BrowseSearch } from '@/components/marketplace/browse-view';

export const metadata: Metadata = {
  title: 'Marketplace | AppWeaver AI',
  description: 'Templates, components, integration guides, agent workflows and starter kits for your AppWeaver projects.',
  alternates: { canonical: '/marketplace' },
};

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<BrowseSearch> }) {
  return <BrowseView search={await searchParams} />;
}
