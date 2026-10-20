import { braveSearch } from '@/lib/outreach/discover';

import { extractHubInvestors } from './extract';
import { fetchPublicPage } from './safe-fetch';
import { addInvestor, type Ctx, getProfile } from './service';

export type Criteria = {
  sector?: string;
  geography?: string;
  stage?: string;
  ticketMin?: number;
  ticketMax?: number;
  instrument?: 'equity' | 'debt' | 'grant';
};

const MAX_QUERIES = 3;
const MAX_PAGES = 4;

export function buildQueries(c: Criteria): string[] {
  const kind =
    c.instrument === 'grant'
      ? 'startup grants funding programmes'
      : c.instrument === 'debt'
        ? 'venture debt revenue-based financing lenders for startups'
        : 'investors venture capital angel accelerators';
  const base = [c.stage, c.sector, c.geography].filter(Boolean).join(' ');
  const ticket = c.ticketMax ? ` cheque size up to ${c.ticketMax}` : '';
  return [
    `${base} ${kind}${ticket}`.trim(),
    `${c.sector ?? 'startup'} ${c.geography ?? ''} ${c.stage ?? ''} ${c.instrument === 'grant' ? 'grant apply' : 'accelerator OR fund "invest in"'}`.replace(/\s+/g, ' ').trim(),
    `"${c.sector ?? 'startups'}" ${c.geography ?? ''} ${c.stage ?? ''} investors portfolio "our focus"`.replace(/\s+/g, ' ').trim(),
  ].slice(0, MAX_QUERIES);
}

export type DiscoverSummary = { pages: number; added: number; duplicates: number; errors: string[] };

/** Searches the public web, extracts structured funders, and stores them as UNVERIFIED with their source page. */
export async function discoverForProject(ctx: Ctx, criteria: Criteria): Promise<DiscoverSummary> {
  const profile = await getProfile(ctx);
  const merged: Criteria = {
    ...criteria,
    sector: criteria.sector || profile?.sector || undefined,
    geography: criteria.geography || profile?.geography || undefined,
    stage: criteria.stage || profile?.stage || undefined,
  };
  const summary: DiscoverSummary = { pages: 0, added: 0, duplicates: 0, errors: [] };
  const seen = new Set<string>();

  for (const query of buildQueries(merged)) {
    let hits;
    try {
      hits = await braveSearch(query, 6);
    } catch (error) {
      summary.errors.push(String(error).slice(0, 160));
      continue;
    }
    for (const hit of hits.slice(0, MAX_PAGES)) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      const page = await fetchPublicPage(hit.url);
      if (!page) continue;
      summary.pages += 1;
      const extracted = await extractHubInvestors(hit.url, page.text).catch((error) => {
        summary.errors.push(`${hit.url}: ${String(error).slice(0, 100)}`);
        return [];
      });
      for (const investor of extracted) {
        if (merged.instrument && investor.instruments.length && !investor.instruments.includes(merged.instrument)) continue;
        const result = await addInvestor(ctx, investor, { sourceUrl: hit.url, verifiedAt: new Date() }).catch(() => null);
        if (!result) continue;
        if (result.created) summary.added += 1;
        else summary.duplicates += 1;
      }
    }
  }
  return summary;
}
