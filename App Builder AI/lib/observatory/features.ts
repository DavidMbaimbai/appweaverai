import { isScannableText, stripArtifactSlug, type EvidenceItem, type SourceFile } from './inventory';

export type FeatureStatus = 'PLANNED' | 'IMPLEMENTED' | 'TESTED' | 'DEPLOYED' | 'KNOWN_ISSUE';

export type FeatureCandidate = {
  key: string;
  name: string;
  present: boolean;
  evidence: EvidenceItem[];
};

type Rule = {
  key: string;
  name: string;
  /** Matches relative file paths. */
  path?: RegExp;
  /** Matches file contents (code files only). */
  content?: RegExp;
  /** When true and nothing matches, an explicit "absent after scanning N files" entry is produced. */
  trackAbsence: boolean;
};

const RULES: Rule[] = [
  {
    key: 'payments-stripe',
    name: 'Stripe payments',
    content: /from\s+['"](?:stripe|@stripe\/[\w-]+)['"]|require\(['"]stripe['"]\)|js\.stripe\.com|loadStripe\s*\(/,
    trackAbsence: true,
  },
  {
    key: 'payments-paypal',
    name: 'PayPal payments',
    content: /from\s+['"]@paypal\/[\w-]+['"]|paypal\.com\/sdk|paypalobjects\.com|PayPalButtons/i,
    trackAbsence: true,
  },
  {
    key: 'auth',
    name: 'User sign-in / accounts',
    path: /(?:^|\/)(?:login|signin|sign-in|signup|sign-up|register|auth)(?:\/|\.|$)/i,
    content: /from\s+['"](?:next-auth|better-auth|@clerk\/[\w-]+|firebase\/auth|@supabase\/supabase-js|@auth0\/[\w-]+)['"]|supabase\.auth\./,
    trackAbsence: true,
  },
  {
    key: 'contact-form',
    name: 'Contact / enquiry form',
    content: /<form\b/i,
    trackAbsence: true,
  },
  {
    key: 'booking',
    name: 'Booking / appointments',
    path: /(?:^|\/)(?:book(?:ing)?s?|appointments?|reservations?|schedule)(?:\/|\.|-|$)/i,
    content: /\b(?:calendly|cal\.com|bookingSlot|appointmentDate|reservation)\b/i,
    trackAbsence: true,
  },
  {
    key: 'cart-checkout',
    name: 'Shopping cart / checkout',
    path: /(?:^|\/)(?:cart|checkout)(?:\/|\.|-|$)/i,
    content: /\b(?:addToCart|useCart|cartItems)\b/,
    trackAbsence: true,
  },
  {
    key: 'email-sending',
    name: 'Email sending',
    content: /from\s+['"](?:nodemailer|resend|@sendgrid\/mail|postmark)['"]/,
    trackAbsence: false,
  },
  {
    key: 'database',
    name: 'Database / data storage',
    content: /from\s+['"](?:@prisma\/client|prisma|drizzle-orm|mongoose|pg|mysql2|@supabase\/supabase-js|firebase\/firestore)['"]/,
    trackAbsence: false,
  },
  {
    key: 'api-endpoints',
    name: 'Server API endpoints',
    path: /(?:^|\/)(?:app\/.*route|pages\/api\/.+|api\/.+)\.(?:tsx?|jsx?|mjs)$/,
    trackAbsence: false,
  },
  {
    key: 'blog-content',
    name: 'Blog / articles',
    path: /(?:^|\/)(?:blog|posts|articles)(?:\/|\.|-|$)/i,
    trackAbsence: false,
  },
  {
    key: 'search',
    name: 'Search',
    path: /(?:^|\/)search(?:\/|\.|-|$)/i,
    content: /type=["']search["']/,
    trackAbsence: false,
  },
];

const MAX_EVIDENCE_PER_FEATURE = 6;

/** Pure static scan: one candidate per rule, with real file evidence or an explicit absence record. */
export function detectFeatureCandidates(files: SourceFile[]): FeatureCandidate[] {
  const scanned = files.filter((f) => typeof f.content === 'string').length;

  return RULES.map((rule) => {
    const evidence: EvidenceItem[] = [];
    for (const file of files) {
      if (evidence.length >= MAX_EVIDENCE_PER_FEATURE) break;
      const relative = stripArtifactSlug(file.path);
      if (rule.path?.test(relative)) {
        evidence.push({ type: 'file', ref: file.path, detail: `Path matches ${rule.name.toLowerCase()} pattern` });
        continue;
      }
      if (rule.content && file.content && isScannableText(relative) && rule.content.test(file.content)) {
        evidence.push({ type: 'file', ref: file.path, detail: `Source references ${rule.name.toLowerCase()}` });
      }
    }

    if (evidence.length === 0 && rule.trackAbsence && scanned > 0) {
      evidence.push({
        type: 'scan_absent',
        ref: `scan:${scanned}-files`,
        detail: `Scanned ${scanned} source files; no ${rule.name.toLowerCase()} usage found`,
      });
    }
    return { key: rule.key, name: rule.name, present: evidence.some((e) => e.type === 'file'), evidence };
  }).filter((c) => c.present || c.evidence.length > 0);
}

export type StatusInput = {
  evidence: EvidenceItem[];
  /** The live deployment was published after the newest file change. */
  deployedCurrent: boolean;
  smokePassedForDeployment: boolean;
  hasOpenIssue: boolean;
};

/**
 * PLANNED unless file evidence exists. IMPLEMENTED = code exists. DEPLOYED = in the
 * live deployment. TESTED = deployed and the latest smoke check passed. KNOWN_ISSUE
 * overrides when an open issue is linked.
 */
export function deriveFeatureStatus(input: StatusInput): FeatureStatus {
  const hasFile = input.evidence.some((e) => e.type === 'file');
  if (!hasFile) return 'PLANNED';
  if (input.hasOpenIssue) return 'KNOWN_ISSUE';
  if (input.deployedCurrent && input.smokePassedForDeployment) return 'TESTED';
  if (input.deployedCurrent) return 'DEPLOYED';
  return 'IMPLEMENTED';
}

/** An "absent" claim is only allowed when the ledger holds an explicit scan record and no file evidence. */
export function isConfirmedAbsent(feature: { status: string; evidence: unknown }): boolean {
  const evidence = Array.isArray(feature.evidence) ? (feature.evidence as EvidenceItem[]) : [];
  return (
    feature.status === 'PLANNED' &&
    evidence.some((e) => e.type === 'scan_absent') &&
    !evidence.some((e) => e.type === 'file')
  );
}

export type FeatureSummary = { key: string; summary: string; refs: string[] };

/** Accepts model output only for known candidates and only when every cited ref is real evidence. */
export function validateSummaries(candidates: FeatureCandidate[], raw: string): Map<string, string> {
  const result = new Map<string, string>();
  let parsed: unknown;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    return result;
  }
  const list = (parsed as { features?: unknown })?.features;
  if (!Array.isArray(list)) return result;

  for (const item of list as Array<Partial<FeatureSummary>>) {
    const candidate = candidates.find((c) => c.key === item?.key);
    if (!candidate || typeof item.summary !== 'string' || !Array.isArray(item.refs) || !item.refs.length) continue;
    const known = new Set(candidate.evidence.map((e) => e.ref));
    if (item.refs.every((r) => typeof r === 'string' && known.has(r))) {
      result.set(candidate.key, item.summary.trim().slice(0, 300));
    }
  }
  return result;
}
