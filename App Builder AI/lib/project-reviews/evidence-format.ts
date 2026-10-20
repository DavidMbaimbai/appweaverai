import { isConfirmedAbsent } from '@/lib/observatory/features';

import { searchKnowledge } from './retrieval';

export type LedgerFeature = {
  key: string;
  name: string;
  summary: string | null;
  status: string;
  evidence: unknown;
  version?: number | null;
};

export type EvidenceBundle = {
  gatheredAt: string;
  features: Array<{
    key: string;
    name: string;
    status: string;
    confirmedAbsent: boolean;
    summary: string | null;
    refs: string[];
  }>;
  deployment: { version: number; status: string; publishedAt: string | null } | null;
  health: { ok: boolean; detail: string; checkedAt: string } | null;
  smoke: { outcome: string; checkedAt: string; version: number | null } | null;
  incidents: Array<{ title: string; status: string }>;
  recurring: Array<{ topic: string; count: number }>;
  knowledge: Array<{ id: string; title: string; content: string }>;
  statusWebhook: { ok: boolean; text: string } | null;
};

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?<![\w])\+?\d[\d\s().-]{7,}\d(?![\w])/g;
const SECRET = /\b(?:sk|pk|rk|whsec|ghp|gho|xox[abp]|AKIA)[-_]?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b[A-Fa-f0-9]{32,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g;

/** Strips emails, phone numbers and key/token-like strings before text reaches the model. */
export function redactSensitive(text: string): string {
  return text
    .replace(SECRET, '[redacted-key]')
    .replace(EMAIL, '[redacted-email]')
    .replace(PHONE, '[redacted-phone]');
}

const ALIASES: Record<string, string> = {
  'payments-stripe': 'payment payments pay card stripe checkout charge billing',
  'payments-paypal': 'payment payments pay paypal checkout charge billing',
  auth: 'login log sign signin signup account password register',
  'contact-form': 'contact form enquiry message submit',
  booking: 'booking book appointment reservation schedule calendar',
  'cart-checkout': 'cart basket checkout order shop buy purchase',
  'email-sending': 'email emails notification confirmation',
  database: 'data saved save storage',
  'api-endpoints': 'api server backend error',
  'blog-content': 'blog article post',
  search: 'search find',
};

export function selectRelevantFeatures(reviewText: string, features: LedgerFeature[], limit = 5): LedgerFeature[] {
  const docs = features.map((f) => ({
    id: f.key,
    title: f.name,
    content: `${f.summary ?? ''} ${ALIASES[f.key] ?? ''}`,
  }));
  const hits = searchKnowledge(reviewText, docs, limit);
  return hits.map((h) => features.find((f) => f.key === h.id)!).filter(Boolean);
}

export function toBundleFeatures(features: LedgerFeature[]): EvidenceBundle['features'] {
  return features.map((f) => {
    const evidence = Array.isArray(f.evidence) ? (f.evidence as Array<{ ref: string }>) : [];
    return {
      key: f.key,
      name: f.name,
      status: f.status,
      confirmedAbsent: isConfirmedAbsent(f),
      summary: f.summary,
      refs: evidence.map((e) => e.ref).slice(0, 6),
    };
  });
}

export function hasRelevantEvidence(bundle: EvidenceBundle) {
  return (
    bundle.features.length > 0 ||
    bundle.knowledge.length > 0 ||
    bundle.incidents.length > 0 ||
    Boolean(bundle.statusWebhook?.ok)
  );
}

export function formatEvidenceForPrompt(bundle: EvidenceBundle): string {
  const lines: string[] = [`Evidence gathered ${bundle.gatheredAt}.`];
  lines.push(
    bundle.deployment
      ? `Deployment: v${bundle.deployment.version} (${bundle.deployment.status}), published ${bundle.deployment.publishedAt ?? 'unknown'}.`
      : 'Deployment: none found.',
  );
  lines.push(
    bundle.health
      ? `Latest health check (${bundle.health.checkedAt}): ${bundle.health.ok ? 'OK' : 'FAILING'} - ${bundle.health.detail}`
      : 'Latest health check: none recorded.',
  );
  lines.push(
    bundle.smoke
      ? `Latest smoke check (${bundle.smoke.checkedAt}): ${bundle.smoke.outcome}.`
      : 'Latest smoke check: none recorded.',
  );
  if (bundle.features.length) {
    lines.push('Relevant features from the ledger:');
    for (const f of bundle.features) {
      lines.push(
        `- ${f.name} [${f.status}]${f.confirmedAbsent ? ' ABSENT: a code scan found no usage' : ''}${f.summary ? ` - ${f.summary}` : ''} (refs: ${f.refs.join(', ') || 'none'})`,
      );
    }
  } else {
    lines.push('Relevant features from the ledger: none found.');
  }
  if (bundle.incidents.length) {
    lines.push('Known incidents: ' + bundle.incidents.map((i) => `${i.title} [${i.status}]`).join('; '));
  }
  if (bundle.recurring.length) {
    lines.push('Recurring complaint topics: ' + bundle.recurring.map((r) => `${r.topic} x${r.count}`).join(', '));
  }
  if (bundle.statusWebhook) {
    lines.push(`Owner status service (${bundle.statusWebhook.ok ? 'ok' : 'error'}): ${bundle.statusWebhook.text}`);
  }
  return lines.join('\n');
}
