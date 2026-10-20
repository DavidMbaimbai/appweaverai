export const ASSET_TYPES = ['TEMPLATE', 'COMPONENT', 'INTEGRATION', 'WORKFLOW', 'STARTER_KIT'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'REMOVED'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const TYPE_LABELS: Record<AssetType, string> = {
  TEMPLATE: 'Template',
  COMPONENT: 'UI component',
  INTEGRATION: 'Integration config',
  WORKFLOW: 'Agent workflow',
  STARTER_KIT: 'Business starter kit',
};

/** URL segment for each type, used by the SEO-friendly /marketplace/[type]/[slug] routes. */
export const TYPE_SEGMENTS: Record<AssetType, string> = {
  TEMPLATE: 'templates',
  COMPONENT: 'components',
  INTEGRATION: 'integrations',
  WORKFLOW: 'workflows',
  STARTER_KIT: 'starter-kits',
};

export function typeFromSegment(segment: string): AssetType | null {
  const hit = (Object.entries(TYPE_SEGMENTS) as Array<[AssetType, string]>).find(([, value]) => value === segment);
  return hit ? hit[0] : null;
}

export const LICENSES: Record<string, { label: string; summary: string; url?: string }> = {
  MIT: { label: 'MIT', summary: 'Use, modify and redistribute freely, keeping the copyright notice.', url: 'https://opensource.org/license/mit' },
  'Apache-2.0': {
    label: 'Apache 2.0',
    summary: 'Use, modify and redistribute freely, with an express patent grant.',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
  'CC0-1.0': { label: 'CC0 1.0', summary: 'Public domain dedication: no restrictions.', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'CC-BY-4.0': { label: 'CC BY 4.0', summary: 'Free to use and adapt with attribution to the creator.', url: 'https://creativecommons.org/licenses/by/4.0/' },
  'marketplace-standard': {
    label: 'Marketplace standard licence',
    summary: 'Use in any number of your own projects, including commercial ones. You may not resell or redistribute the asset itself.',
  },
};

export const LICENSE_KEYS = Object.keys(LICENSES);

export const LIMITS = {
  maxFiles: 60,
  maxFileBytes: 200_000,
  maxBundleBytes: 1_000_000,
  maxPathLength: 200,
  maxPathDepth: 8,
  maxTags: 8,
  maxTagLength: 24,
  titleMin: 3,
  titleMax: 80,
  summaryMax: 200,
  descriptionMax: 5000,
  reviewMax: 2000,
  reportMax: 2000,
  maxWorkflowSteps: 30,
  minPriceCents: 100,
  maxPriceCents: 50_000,
  /** Abuse controls for creators. */
  maxPendingPerCreator: 10,
  maxAssetsPerCreator: 100,
} as const;

export const REPORT_REASONS = ['copyright', 'malware', 'secrets', 'misleading', 'illegal', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
