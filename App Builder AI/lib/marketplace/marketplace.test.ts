import { describe, expect, it } from 'vitest';

import { checksumOf, validateBundle, validateRelativePath } from './bundle';
import { earningKey, ledgerBalance, refundReversal, reversalKey, splitSale } from './earnings';
import { planInstall } from './install-plan';
import { moderationDecision, reviewEligibility } from './rules';
import { scanBundle } from './scan';
import { firstPartyAssets } from './seed-content';
import { KNOWN_INTEGRATION_IDS } from './submit';
import { LIMITS } from './types';

const known = new Set<string>(['stripe']);
const bundleOf = (files: Array<{ path: string; content: string }>) => ({ schemaVersion: 1, files });

describe('validateRelativePath', () => {
  it.each(['../x.html', 'a/../../x.html', '/etc/x.html', 'C:/x.html', 'a\\b.html', '.env', 'node_modules/a.js', 'a/.git/x.json', 'tool.exe', 'run.sh', 'CON.html'])(
    'rejects %s',
    (p) => {
      expect(validateRelativePath(p, { requireExtension: true })).not.toBeNull();
    },
  );
  it('accepts ordinary nested paths', () => {
    expect(validateRelativePath('src/components/form.tsx', { requireExtension: true })).toBeNull();
  });
});

describe('validateBundle', () => {
  it('accepts a small valid bundle and checksums it stably', () => {
    const files = [
      { path: 'b.html', content: '<p>b</p>' },
      { path: 'a.css', content: 'p{}' },
    ];
    const a = validateBundle(bundleOf(files), 'TEMPLATE', known);
    const b = validateBundle(bundleOf([...files].reverse()), 'TEMPLATE', known);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.checksum).toBe(b.checksum);
      expect(checksumOf(a.bundle)).toBe(a.checksum);
    }
  });
  it('rejects traversal paths, duplicates and oversize files', () => {
    expect(validateBundle(bundleOf([{ path: '../evil.html', content: 'x' }]), 'TEMPLATE', known).ok).toBe(false);
    expect(
      validateBundle(
        bundleOf([
          { path: 'a.html', content: 'x' },
          { path: 'A.html', content: 'y' },
        ]),
        'TEMPLATE',
        known,
      ).ok,
    ).toBe(false);
    expect(validateBundle(bundleOf([{ path: 'a.html', content: 'x'.repeat(LIMITS.maxFileBytes + 1) }]), 'TEMPLATE', known).ok).toBe(false);
  });
  it('rejects malformed input', () => {
    expect(validateBundle(null, 'TEMPLATE', known).ok).toBe(false);
    expect(validateBundle({ files: 'nope' }, 'TEMPLATE', known).ok).toBe(false);
  });
});

describe('scanBundle', () => {
  it('blocks a bundle containing a private key', async () => {
    const key = ['-----BEGIN RSA PRIVATE', 'KEY-----\nabc\n-----END RSA PRIVATE KEY-----'].join(' ');
    const v = validateBundle(bundleOf([{ path: 'a.txt', content: key }]), 'TEMPLATE', known);
    expect(v.ok).toBe(true);
    if (v.ok) expect((await scanBundle(v.bundle)).verdict).toBe('blocked');
  });
});

describe('first-party seed content', () => {
  it('validates and is not blocked by the scan', async () => {
    const seeds = firstPartyAssets();
    expect(seeds.length).toBeGreaterThanOrEqual(4);
    for (const seed of seeds) {
      const v = validateBundle(seed.bundle, seed.type, KNOWN_INTEGRATION_IDS);
      expect(v.ok, seed.slug).toBe(true);
      if (v.ok) expect((await scanBundle(v.bundle)).verdict, seed.slug).not.toBe('blocked');
    }
  });
});

describe('planInstall conflict detection', () => {
  const files = [
    { path: 'index.html', content: 'a' },
    { path: 'css/site.css', content: 'b' },
  ];
  it('lists conflicts and writes nothing with abort', () => {
    const plan = planInstall({ files, artifactSlug: 'app', targetDir: '', existingPaths: ['app/Index.html'], strategy: 'abort' });
    expect(plan.ok && plan.conflicts).toEqual([{ path: 'app/index.html', reason: 'exists' }]);
    expect(plan.ok && plan.writes).toEqual([]);
  });
  it('skips only conflicting files with skip', () => {
    const plan = planInstall({ files, artifactSlug: 'app', targetDir: 'kit', existingPaths: ['app/kit/index.html'], strategy: 'skip' });
    expect(plan.ok && plan.writes.map((w) => w.dbPath)).toEqual(['app/kit/css/site.css']);
  });
  it('detects file/folder clashes and bad target dirs', () => {
    const clash = planInstall({ files, artifactSlug: 'app', targetDir: '', existingPaths: ['app/css'], strategy: 'abort' });
    expect(clash.ok && clash.conflicts[0]?.reason).toBe('file_folder_clash');
    expect(planInstall({ files, artifactSlug: 'app', targetDir: '../x', existingPaths: [], strategy: 'abort' }).ok).toBe(false);
  });
});

describe('reviewEligibility', () => {
  const base = { isCreator: false, hasInstall: false, hasPaidOrder: false, alreadyReviewed: false, assetStatus: 'PUBLISHED' as const };
  it('requires an install or purchase', () => {
    expect(reviewEligibility(base).ok).toBe(false);
    expect(reviewEligibility({ ...base, hasInstall: true }).ok).toBe(true);
    expect(reviewEligibility({ ...base, hasPaidOrder: true })).toEqual({ ok: true, basis: 'purchase' });
  });
  it('blocks creators, duplicates and unpublished assets', () => {
    expect(reviewEligibility({ ...base, hasInstall: true, isCreator: true }).ok).toBe(false);
    expect(reviewEligibility({ ...base, hasInstall: true, alreadyReviewed: true }).ok).toBe(false);
    expect(reviewEligibility({ ...base, hasInstall: true, assetStatus: 'REMOVED' }).ok).toBe(false);
  });
});

describe('moderationDecision', () => {
  it('never approves a scan-blocked or non-pending version', () => {
    expect(moderationDecision({ action: 'approve', versionStatus: 'PENDING_REVIEW', scanVerdict: 'blocked' }).ok).toBe(false);
    expect(moderationDecision({ action: 'approve', versionStatus: 'PUBLISHED', scanVerdict: 'clean' }).ok).toBe(false);
    expect(moderationDecision({ action: 'approve', versionStatus: 'PENDING_REVIEW', scanVerdict: 'flagged' }).ok).toBe(true);
  });
  it('requires reasons for reject and remove', () => {
    expect(moderationDecision({ action: 'reject', versionStatus: 'PENDING_REVIEW', scanVerdict: 'clean' }).ok).toBe(false);
    expect(moderationDecision({ action: 'remove', versionStatus: 'PUBLISHED', scanVerdict: 'clean', reason: 'copyright claim' }).ok).toBe(true);
    expect(moderationDecision({ action: 'restore', versionStatus: 'PUBLISHED', scanVerdict: 'clean' }).ok).toBe(false);
  });
});

describe('earnings ledger math', () => {
  it('splits a sale so fee and share sum to the amount', () => {
    expect(splitSale(999, 1000)).toEqual({ platformFeeCents: 100, creatorShareCents: 899 });
    expect(splitSale(1000, 0)).toEqual({ platformFeeCents: 0, creatorShareCents: 1000 });
    expect(() => splitSale(-1, 100)).toThrow();
    expect(() => splitSale(100, 10_001)).toThrow();
  });
  it('reverses pro-rata and cumulatively without over-reversing', () => {
    const s = splitSale(1000, 2000); // share 800
    const first = refundReversal({ amountCents: 1000, creatorShareCents: s.creatorShareCents, refundedBeforeCents: 0, reversedBeforeCents: 0, totalRefundedCents: 500 });
    expect(first).toEqual({ reverseCents: 400, refundedCents: 500 });
    const replay = refundReversal({ amountCents: 1000, creatorShareCents: 800, refundedBeforeCents: 500, reversedBeforeCents: 400, totalRefundedCents: 500 });
    expect(replay.reverseCents).toBe(0);
    const full = refundReversal({ amountCents: 1000, creatorShareCents: 800, refundedBeforeCents: 500, reversedBeforeCents: 400, totalRefundedCents: 5000 });
    expect(full).toEqual({ reverseCents: 400, refundedCents: 1000 });
  });
  it('nets earnings and reversals in the balance with distinct idempotency keys', () => {
    expect(ledgerBalance([{ kind: 'EARNING', amountCents: 800 }, { kind: 'REFUND_REVERSAL', amountCents: -400 }])).toBe(400);
    expect(earningKey('o1')).not.toBe(reversalKey('o1', 500));
    expect(reversalKey('o1', 500)).not.toBe(reversalKey('o1', 1000));
  });
});
