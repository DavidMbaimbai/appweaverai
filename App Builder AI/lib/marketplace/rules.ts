import type { AssetStatus } from './types';

export type ReviewEligibility =
  | { ok: true; basis: 'install' | 'purchase' }
  | { ok: false; reason: string };

/** Only verified installers or purchasers may review; creators cannot review themselves; one review per user. */
export function reviewEligibility(args: {
  isCreator: boolean;
  hasInstall: boolean;
  hasPaidOrder: boolean;
  alreadyReviewed: boolean;
  assetStatus: AssetStatus;
}): ReviewEligibility {
  if (args.assetStatus !== 'PUBLISHED') return { ok: false, reason: 'This asset is not available for reviews.' };
  if (args.isCreator) return { ok: false, reason: 'You cannot review your own asset.' };
  if (args.alreadyReviewed) return { ok: false, reason: 'You have already reviewed this asset.' };
  if (args.hasPaidOrder) return { ok: true, basis: 'purchase' };
  if (args.hasInstall) return { ok: true, basis: 'install' };
  return { ok: false, reason: 'Only people who installed or purchased this asset can review it.' };
}

export type ModerationAction = 'approve' | 'reject' | 'remove' | 'restore';

/** Moderation gating: only a pending submission can be approved or rejected; a scan-blocked version can never be approved. */
export function moderationDecision(args: {
  action: ModerationAction;
  versionStatus: AssetStatus;
  scanVerdict: string;
  reason?: string;
}): { ok: true } | { ok: false; error: string } {
  const reason = args.reason?.trim() ?? '';
  switch (args.action) {
    case 'approve':
      if (args.versionStatus !== 'PENDING_REVIEW') return { ok: false, error: 'Only a pending submission can be approved.' };
      if (args.scanVerdict === 'blocked') return { ok: false, error: 'This version failed the safety scan and cannot be approved.' };
      return { ok: true };
    case 'reject':
      if (args.versionStatus !== 'PENDING_REVIEW') return { ok: false, error: 'Only a pending submission can be rejected.' };
      if (reason.length < 5) return { ok: false, error: 'Give the creator a reason (at least 5 characters).' };
      return { ok: true };
    case 'remove':
      if (args.versionStatus === 'REMOVED') return { ok: false, error: 'Already removed.' };
      if (reason.length < 5) return { ok: false, error: 'A takedown needs a recorded reason.' };
      return { ok: true };
    case 'restore':
      if (args.versionStatus !== 'REMOVED') return { ok: false, error: 'Only a removed asset can be restored.' };
      return { ok: true };
  }
}

export type InstallGate =
  | { ok: true }
  | { ok: false; error: string };

/** New installs need a published asset, a published version and (for paid assets) a purchase, unless the caller is the creator. */
export function installGate(args: {
  assetStatus: AssetStatus;
  versionStatus: AssetStatus | null;
  priceCents: number;
  isCreator: boolean;
  hasPaidOrder: boolean;
}): InstallGate {
  if (args.assetStatus !== 'PUBLISHED' || args.versionStatus !== 'PUBLISHED') {
    return { ok: false, error: 'This asset is not available for install.' };
  }
  if (args.priceCents > 0 && !args.isCreator && !args.hasPaidOrder) {
    return { ok: false, error: 'Purchase this asset to install it.' };
  }
  return { ok: true };
}
