import { recordAuditLog } from '@/lib/admin/audit';
import { prisma } from '@/lib/prisma';

import { validateBundle } from './bundle';
import { scanBundle } from './scan';
import { firstPartyAssets } from './seed-content';
import { KNOWN_INTEGRATION_IDS } from './submit';

export type SeedReport = { created: string[]; updated: string[]; unchanged: string[]; failed: Array<{ slug: string; error: string }> };

/**
 * Idempotently publishes the first-party free assets. Each bundle goes through the same validation and scan as a
 * creator submission; a changed bundle becomes a new immutable version. No ratings, installs or reviews are created.
 */
export async function seedFirstPartyAssets(actor: { id: string; email?: string | null }): Promise<SeedReport> {
  const report: SeedReport = { created: [], updated: [], unchanged: [], failed: [] };
  const now = new Date();

  for (const seed of firstPartyAssets()) {
    const validation = validateBundle(seed.bundle, seed.type, KNOWN_INTEGRATION_IDS);
    if (!validation.ok) {
      report.failed.push({ slug: seed.slug, error: validation.errors.join(' ') });
      continue;
    }
    const scan = await scanBundle(validation.bundle);
    if (scan.verdict === 'blocked') {
      report.failed.push({ slug: seed.slug, error: 'Blocked by the safety scan.' });
      continue;
    }
    const versionData = {
      bundle: validation.bundle as unknown as object,
      checksum: validation.checksum,
      sizeBytes: validation.sizeBytes,
      fileCount: validation.fileCount,
      status: 'PUBLISHED' as const,
      scanVerdict: scan.verdict,
      scanFindings: scan.findings as unknown as object[],
    };

    const existing = await prisma.marketplaceAsset.findUnique({
      where: { slug: seed.slug },
      select: { id: true, isFirstParty: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, checksum: true } } },
    });
    if (existing && !existing.isFirstParty) {
      report.failed.push({ slug: seed.slug, error: 'Slug is taken by a creator asset.' });
      continue;
    }
    if (!existing) {
      await prisma.marketplaceAsset.create({
        data: {
          isFirstParty: true,
          type: seed.type,
          slug: seed.slug,
          title: seed.title,
          summary: seed.summary,
          description: seed.description,
          tags: seed.tags,
          license: seed.license,
          priceCents: 0,
          status: 'PUBLISHED',
          publishedVersion: 1,
          publishedAt: now,
          reviewedById: actor.id,
          reviewedAt: now,
          versions: { create: { version: 1, changelog: 'First-party release.', ...versionData } },
        },
      });
      report.created.push(seed.slug);
    } else if (existing.versions[0]?.checksum !== validation.checksum) {
      const next = (existing.versions[0]?.version ?? 0) + 1;
      await prisma.$transaction([
        prisma.marketplaceAssetVersion.create({ data: { assetId: existing.id, version: next, changelog: 'Updated first-party content.', ...versionData } }),
        prisma.marketplaceAsset.update({ where: { id: existing.id }, data: { status: 'PUBLISHED', publishedVersion: next, reviewedById: actor.id, reviewedAt: now } }),
      ]);
      report.updated.push(seed.slug);
    } else {
      report.unchanged.push(seed.slug);
    }
  }

  await recordAuditLog({
    adminId: actor.id,
    adminEmail: actor.email ?? null,
    action: 'marketplace.seed_first_party',
    targetType: 'Marketplace',
    after: { created: report.created.length, updated: report.updated.length, failed: report.failed.length },
  });
  return report;
}
