import { buildUntrustedCall, redactSensitive } from '@/lib/agents/untrusted';

/**
 * Grounded AI recommendations. The model only ever sees aggregated, already-computed metrics (never rows or PII),
 * and every recommendation must cite metric ids that exist in the catalogue. The evidence shown to the user is
 * rebuilt from the catalogue, never taken from the model's text.
 */

export type CatalogMetric = {
  id: string;
  label: string;
  value: number;
  unit: 'count' | 'percent' | 'cents' | 'ratio';
  period: string;
};

export const ACTION_TYPES = ['UTM_LINK', 'DRAFT_CAMPAIGN', 'FIX_TRACKING', 'MANUAL_TASK'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type Recommendation = {
  title: string;
  rationale: string;
  metricIds: string[];
  action: { type: ActionType; brief: string };
};

export type EvidenceRow = { id: string; label: string; value: number; unit: CatalogMetric['unit']; period: string };

export type RecommendationScope = 'PLATFORM' | 'PROJECT';

/** Minimum volumes before any recommendation is attempted. Below these the honest answer is "not enough data". */
export const MIN_DATA: Record<RecommendationScope, { id: string; min: number; hint: string }[]> = {
  PLATFORM: [
    { id: 'funnel.visitors', min: 100, hint: 'at least 100 consented visits' },
    { id: 'funnel.signups', min: 20, hint: 'at least 20 signups' },
  ],
  PROJECT: [{ id: 'project.views', min: 50, hint: 'at least 50 page views' }],
};

export function dataSufficiency(scope: RecommendationScope, catalog: CatalogMetric[]): { ok: true } | { ok: false; reason: string } {
  const byId = new Map(catalog.map((m) => [m.id, m.value]));
  const missing = MIN_DATA[scope].filter((r) => (byId.get(r.id) ?? 0) < r.min).map((r) => r.hint);
  return missing.length ? { ok: false, reason: `Not enough data yet: needs ${missing.join(' and ')} in the period.` } : { ok: true };
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').slice(0, 60);

/** Stable metric id: `<group>.<name>` or `<group>:<slug>.<name>`. */
export const metricId = (group: string, name: string, key?: string) => (key ? `${group}:${slug(key)}.${name}` : `${group}.${name}`);

export function assertNoPii(text: string) {
  if (redactSensitive(text) !== text) throw new Error('Prompt contains something that looks like an email address, phone number or secret.');
}

const SYSTEM = `You are a cautious growth analyst. You receive a catalogue of aggregated, already-computed metrics, each with an id.
Rules:
- Every recommendation MUST cite the ids of the metrics it relies on in "metricIds". Use only ids that appear in the catalogue.
- Cite only numbers that appear in those metrics. Never invent, estimate or extrapolate figures, benchmarks or industry averages.
- Do not promise or predict outcomes ("will increase", "guaranteed", uplift percentages). Phrase ideas as things to test.
- A metric that is absent is unknown, not zero.
- Each action is only a proposal that a human must approve; none spends money or publishes automatically.
- Propose 1-4 recommendations. "action.type" must be one of: ${ACTION_TYPES.join(', ')}.
Return ONLY JSON: {"recommendations":[{"title":"...","rationale":"...","metricIds":["..."],"action":{"type":"...","brief":"..."}}]}`;

export function buildRecommendationCall(scope: RecommendationScope, catalog: CatalogMetric[], periodDays: number) {
  const json = JSON.stringify({ periodDays, metrics: catalog.map((m) => ({ id: m.id, label: m.label, value: m.value, unit: m.unit, period: m.period })) });
  assertNoPii(json);
  return buildUntrustedCall({
    system: SYSTEM,
    task: `Scope: ${scope === 'PLATFORM' ? "AppWeaver's own acquisition funnel" : "a customer's published app"}. Analyse the metrics below and return the JSON.`,
    // Channel and campaign labels originate from visitor-supplied UTM values, so the whole catalogue is untrusted data.
    untrusted: [{ label: 'metrics', content: json, maxLength: 20_000 }],
  });
}

const PROMISE = /\b(will (?:increase|double|triple|grow|boost|raise)|guarantee[sd]?|certain(?:ly)? (?:to|will)|\d+\s?x\b)/i;

function numbersIn(text: string) {
  return [...text.matchAll(/(?<![\w.:/-])\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.005);

function allowedForms(m: CatalogMetric) {
  const forms = [m.value, Math.round(m.value)];
  if (m.unit === 'percent') forms.push(m.value * 100, Math.round(m.value * 100), Math.round(m.value * 1000) / 10);
  if (m.unit === 'cents') forms.push(m.value / 100, Math.round(m.value / 100));
  if (m.unit === 'ratio') forms.push(Math.round(m.value * 100) / 100, Math.round(m.value * 10) / 10);
  return forms;
}

export type Rejection = { title: string; reason: string };

export function parseRecommendations(raw: string, catalog: CatalogMetric[], opts: { allowedNumbers?: number[]; max?: number } = {}) {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const accepted: { recommendation: Recommendation; evidence: EvidenceRow[] }[] = [];
  const rejected: Rejection[] = [];
  let list: unknown[] = [];
  try {
    const text = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(text) as { recommendations?: unknown };
    list = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  } catch {
    return { accepted, rejected: [{ title: '(response)', reason: 'Not valid JSON.' }] };
  }

  for (const item of list.slice(0, opts.max ?? 4)) {
    const r = item as Partial<Recommendation>;
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 140) : '';
    const reject = (reason: string) => rejected.push({ title: title || '(untitled)', reason });
    const rationale = typeof r.rationale === 'string' ? r.rationale.trim().slice(0, 1200) : '';
    if (!title || !rationale) {
      reject('Missing title or rationale.');
      continue;
    }
    const ids = Array.isArray(r.metricIds) ? [...new Set(r.metricIds.filter((x): x is string => typeof x === 'string'))] : [];
    if (!ids.length) {
      reject('Cites no metric id.');
      continue;
    }
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) {
      reject(`Cites unknown metric id(s): ${unknown.join(', ')}.`);
      continue;
    }
    const type = r.action?.type;
    if (!type || !(ACTION_TYPES as readonly string[]).includes(type)) {
      reject('Unsupported action type.');
      continue;
    }
    if (PROMISE.test(`${title} ${rationale}`)) {
      reject('Promises an outcome.');
      continue;
    }
    const cited = ids.map((id) => byId.get(id)!);
    const allowed = [...cited.flatMap(allowedForms), ...(opts.allowedNumbers ?? [])];
    const stray = numbersIn(rationale).filter((n) => !allowed.some((a) => close(n, a)));
    if (stray.length) {
      reject(`States number(s) not found in the cited metrics: ${stray.join(', ')}.`);
      continue;
    }
    accepted.push({
      recommendation: { title, rationale, metricIds: ids, action: { type, brief: String(r.action?.brief ?? '').trim().slice(0, 600) } },
      evidence: cited.map((m) => ({ id: m.id, label: m.label, value: m.value, unit: m.unit, period: m.period })),
    });
  }
  return { accepted, rejected };
}

export function formatMetricValue(value: number, unit: CatalogMetric['unit']) {
  if (unit === 'percent') return `${Math.round(value * 1000) / 10}%`;
  if (unit === 'cents') return `$${(value / 100).toFixed(2)}`;
  if (unit === 'ratio') return `${Math.round(value * 100) / 100}x`;
  return new Intl.NumberFormat('en-US').format(value);
}
