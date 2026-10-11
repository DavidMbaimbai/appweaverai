import { cache } from 'react';

import { prisma } from '../prisma';
import type {
  TemplateKind,
  TemplateMarket,
} from '@/lib/generated/prisma/client';

export type WebsiteTemplateSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: TemplateKind;
  market: TemplateMarket;
  previewImageUrl: string | null;
};

/** Browsable library listing for the template/section gallery (/app/templates). */
export const listWebsiteTemplates = cache(
  async (filters?: {
    kind?: TemplateKind;
    market?: TemplateMarket;
  }): Promise<WebsiteTemplateSummary[]> => {
    return prisma.websiteTemplate.findMany({
      where: {
        isPublished: true,
        ...(filters?.kind ? { kind: filters.kind } : {}),
        ...(filters?.market ? { market: filters.market } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        kind: true,
        market: true,
        previewImageUrl: true,
      },
    });
  },
);

/** Full record (with file contents) used to materialize a template into a project/artifact. */
export async function getWebsiteTemplateForUse(slug: string) {
  return prisma.websiteTemplate.findUnique({
    where: { slug, isPublished: true },
    include: {
      files: { select: { path: true, content: true } },
    },
  });
}
