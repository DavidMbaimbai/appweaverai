import { validateAppId } from './capacitor';

export const MOBILE_STORES = ['GOOGLE_PLAY', 'APP_STORE_CONNECT'] as const;
export type MobileStoreId = (typeof MOBILE_STORES)[number];

export const STORE_LABELS: Record<MobileStoreId, string> = {
  GOOGLE_PLAY: 'Google Play',
  APP_STORE_CONNECT: 'App Store Connect',
};

type StoreLimits = {
  name: number;
  shortDescription: number;
  description: number;
  keywords: number;
  minScreenshots: number;
  ageRatings: readonly string[];
};

/** Character limits published by each store at the time of writing; the stores remain the source of truth. */
export const STORE_LIMITS: Record<MobileStoreId, StoreLimits> = {
  GOOGLE_PLAY: {
    name: 30,
    shortDescription: 80,
    description: 4000,
    keywords: 0,
    minScreenshots: 2,
    ageRatings: ['EVERYONE', 'TEN_PLUS', 'TEEN', 'MATURE_17', 'ADULTS_ONLY_18'],
  },
  APP_STORE_CONNECT: {
    name: 30,
    shortDescription: 30,
    description: 4000,
    keywords: 100,
    minScreenshots: 1,
    ageRatings: ['4+', '9+', '12+', '17+'],
  },
};

export type ListingInput = {
  appName: string;
  bundleId: string;
  shortDescription: string;
  description: string;
  category: string;
  keywords: string;
  privacyUrl: string;
  supportUrl: string;
  ageRating: string;
  screenshotRefs: string[];
};

export type ListingIssue = { field: keyof ListingInput; message: string };

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** A screenshot ref is an https URL or a project-relative path; never a local or traversal path. */
export function isValidScreenshotRef(ref: string) {
  if (/^https:\/\//i.test(ref)) return isHttpsUrl(ref);
  return /^[A-Za-z0-9_\-./]+$/.test(ref) && !ref.includes('..') && !ref.startsWith('/');
}

export function validateListing(store: MobileStoreId, input: ListingInput): ListingIssue[] {
  const limits = STORE_LIMITS[store];
  const issues: ListingIssue[] = [];
  const add = (field: keyof ListingInput, message: string) => issues.push({ field, message });
  const label = STORE_LABELS[store];

  if (!input.appName.trim()) add('appName', 'App name is required.');
  else if (input.appName.trim().length > limits.name) add('appName', `${label} allows at most ${limits.name} characters.`);

  const idError = validateAppId(input.bundleId);
  if (idError) add('bundleId', idError);

  if (!input.shortDescription.trim()) add('shortDescription', store === 'GOOGLE_PLAY' ? 'Short description is required.' : 'Subtitle is required.');
  else if (input.shortDescription.trim().length > limits.shortDescription) {
    add('shortDescription', `${label} allows at most ${limits.shortDescription} characters.`);
  }

  if (input.description.trim().length < 50) add('description', 'Describe the app in at least 50 characters.');
  else if (input.description.length > limits.description) add('description', `${label} allows at most ${limits.description} characters.`);

  if (store === 'APP_STORE_CONNECT' && input.keywords.length > limits.keywords) {
    add('keywords', `Keywords may total at most ${limits.keywords} characters.`);
  }

  if (!input.category.trim()) add('category', 'Choose a category.');

  if (!isHttpsUrl(input.privacyUrl)) add('privacyUrl', 'A privacy policy URL starting with https:// is required by both stores.');
  if (input.supportUrl && !isHttpsUrl(input.supportUrl)) add('supportUrl', 'Support URL must start with https://.');

  if (!limits.ageRatings.includes(input.ageRating)) {
    add('ageRating', `Choose one of: ${limits.ageRatings.join(', ')}. Complete the store's rating questionnaire to confirm.`);
  }

  if (input.screenshotRefs.length < limits.minScreenshots) {
    add('screenshotRefs', `${label} needs at least ${limits.minScreenshots} screenshot${limits.minScreenshots === 1 ? '' : 's'}.`);
  } else if (input.screenshotRefs.length > 10) {
    add('screenshotRefs', 'Use at most 10 screenshots.');
  }
  const bad = input.screenshotRefs.filter((ref) => !isValidScreenshotRef(ref));
  if (bad.length > 0) add('screenshotRefs', `Invalid screenshot reference: ${bad[0]}. Use an https URL or a project-relative path.`);

  return issues;
}

export type ChecklistItem = {
  key: string;
  label: string;
  detail: string;
  /** Automatic items are derived from stored data; manual items are confirmed by the owner. */
  kind: 'auto' | 'manual';
};

const COMMON: ChecklistItem[] = [
  { key: 'listing-valid', label: 'Store listing is complete and valid', detail: 'Name, descriptions, category, age rating and screenshots pass validation.', kind: 'auto' },
  { key: 'privacy-url', label: 'Privacy policy URL is public (https)', detail: 'Both stores reject apps without a reachable privacy policy.', kind: 'auto' },
  { key: 'credentials', label: 'Store credentials saved', detail: 'Needed for automated uploads; you can still upload manually without them.', kind: 'auto' },
  { key: 'bundle', label: 'Capacitor project bundle generated', detail: 'A successful Capacitor bundle build exists for this project.', kind: 'auto' },
  { key: 'review-guidelines', label: 'Reviewed the store review guidelines', detail: 'Pay attention to minimum functionality: a thin website wrapper is commonly rejected.', kind: 'manual' },
  { key: 'reviewer-access', label: 'Reviewer test account / demo access prepared', detail: 'If sign-in is required, give reviewers working credentials.', kind: 'manual' },
];

const BY_STORE: Record<MobileStoreId, ChecklistItem[]> = {
  GOOGLE_PLAY: [
    { key: 'developer-account', label: 'Google Play developer account created and verified', detail: 'One-time registration fee; new personal accounts must meet testing requirements before production release.', kind: 'manual' },
    { key: 'signing', label: 'Upload keystore created and Play App Signing enabled', detail: 'Back up the upload key; builds must be signed .aab bundles.', kind: 'manual' },
    { key: 'data-safety', label: 'Data safety form completed', detail: 'Declare data collected/shared; must match your privacy policy.', kind: 'manual' },
    { key: 'content-rating', label: 'Content rating questionnaire completed', detail: 'Required before release.', kind: 'manual' },
    { key: 'target-api', label: 'Target API level meets current Play requirement', detail: 'Google raises the minimum targetSdk yearly; check the Play Console policy page.', kind: 'manual' },
    ...COMMON,
  ],
  APP_STORE_CONNECT: [
    { key: 'developer-account', label: 'Apple Developer Program membership active', detail: 'Annual membership; required for signing and distribution.', kind: 'manual' },
    { key: 'signing', label: 'Distribution certificate and provisioning profile configured', detail: 'Managed in Xcode or the Apple Developer portal. Archiving requires macOS.', kind: 'manual' },
    { key: 'privacy-labels', label: 'App Privacy ("nutrition labels") answers completed', detail: 'Declare data collection and tracking; must match your privacy policy.', kind: 'manual' },
    { key: 'export-compliance', label: 'Export compliance (encryption) answers completed', detail: 'Apps using HTTPS usually qualify for the exemption; confirm in App Store Connect.', kind: 'manual' },
    { key: 'testflight', label: 'Tested through TestFlight on real devices', detail: 'Catches WKWebView and safe-area issues before review.', kind: 'manual' },
    ...COMMON,
  ],
};

export function storeChecklist(store: MobileStoreId): ChecklistItem[] {
  return BY_STORE[store];
}

export type ChecklistFacts = {
  listingValid: boolean;
  privacyUrlValid: boolean;
  credentialsSaved: boolean;
  bundleBuilt: boolean;
};

export type ChecklistResult = (ChecklistItem & { done: boolean })[];

export function evaluateChecklist(store: MobileStoreId, facts: ChecklistFacts, manualDone: ReadonlySet<string>): ChecklistResult {
  const auto: Record<string, boolean> = {
    'listing-valid': facts.listingValid,
    'privacy-url': facts.privacyUrlValid,
    credentials: facts.credentialsSaved,
    bundle: facts.bundleBuilt,
  };
  return storeChecklist(store).map((item) => ({
    ...item,
    done: item.kind === 'auto' ? Boolean(auto[item.key]) : manualDone.has(item.key),
  }));
}

export function isManualChecklistKey(store: MobileStoreId, key: string) {
  return storeChecklist(store).some((item) => item.key === key && item.kind === 'manual');
}
