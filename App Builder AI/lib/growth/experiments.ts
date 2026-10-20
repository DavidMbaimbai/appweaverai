import { METRIC_KEYS, type Metric, type MetricKey } from './metrics';

export const EXPERIMENT_STATUSES = ['PROPOSED', 'APPROVED', 'RUNNING', 'MEASURED', 'REJECTED'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

const TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  PROPOSED: ['APPROVED', 'REJECTED'],
  APPROVED: ['RUNNING', 'REJECTED'],
  RUNNING: ['MEASURED'],
  MEASURED: [],
  REJECTED: [],
};

export const canTransition = (from: ExperimentStatus, to: ExperimentStatus) => TRANSITIONS[from]?.includes(to) ?? false;

/** Only safe actions that already exist in the product; none spends money or publishes anything. */
export const ACTION_TYPES = ['MARKETING_CAMPAIGN_DRAFT', 'DEV_TICKET', 'LANDING_PAGE_PROMPT', 'MANUAL'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type ProposedAction = {
  type: ActionType;
  title: string;
  brief: string;
  metricKey: MetricKey;
  citedMetrics: { key: MetricKey; value: number }[];
  priority: number;
};

export type ExperimentProposal = {
  hypothesis: string;
  bottleneck: string;
  action: ProposedAction;
  estimatedCostCents: number | null;
};

const GUARANTEE = /\b(guarantee[ds]?|will (double|triple|increase|boost|grow|improve)|definitely|certainly|for sure|\d+\s?x\b|\d+\s?% (more|increase|growth|uplift|higher))/i;

/** Every number in model prose must be one we supplied, so nothing is invented. */
export function numbersAreProvided(text: string, allowed: Set<number>) {
  const found = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return found.every((n) => allowed.has(Number(n.replace(',', '.'))));
}

export function allowedNumbers(metrics: Metric[], extra: number[] = []) {
  const set = new Set<number>(extra);
  for (const m of metrics) if (m.value != null) set.add(m.value);
  return set;
}

/**
 * Validates model output against the metrics we actually measured. Proposals are dropped (never repaired) when
 * they cite a metric/number we didn't provide, promise outcomes, or name an action that doesn't exist.
 */
export function parseProposals(raw: string, metrics: Metric[], extraNumbers: number[] = []): ExperimentProposal[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: { experiments?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.experiments)) return [];
  const measured = new Map(metrics.filter((m) => m.value != null).map((m) => [m.key, m.value as number]));
  const allowed = allowedNumbers(metrics, extraNumbers);
  const out: ExperimentProposal[] = [];

  for (const item of parsed.experiments as Record<string, unknown>[]) {
    const action = (item?.action ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const hypothesis = str(item?.hypothesis, 600);
    const bottleneck = str(item?.bottleneck, 400);
    const title = str(action.title, 120);
    const brief = str(action.brief, 1500);
    const type = action.type as ActionType;
    const metricKey = action.metricKey as MetricKey;
    if (!hypothesis || !bottleneck || !title || !brief) continue;
    if (!ACTION_TYPES.includes(type) || !METRIC_KEYS.includes(metricKey)) continue;
    if (GUARANTEE.test(`${hypothesis} ${bottleneck} ${title} ${brief}`)) continue;
    if (!numbersAreProvided(`${hypothesis} ${bottleneck}`, allowed)) continue;

    const cited = (Array.isArray(action.citedMetrics) ? action.citedMetrics : [])
      .map((c: { key?: unknown; value?: unknown }) => ({ key: c?.key as MetricKey, value: Number(c?.value) }))
      .filter((c) => measured.has(c.key) && measured.get(c.key) === c.value);
    if (!cited.length) continue;

    const cost = Number(item?.estimatedCostCents);
    const priority = Number(action.priority);
    out.push({
      hypothesis,
      bottleneck,
      estimatedCostCents: Number.isInteger(cost) && cost >= 0 && cost <= 100_000_00 ? cost : null,
      action: {
        type,
        title,
        brief,
        metricKey,
        citedMetrics: cited,
        priority: Number.isFinite(priority) ? Math.max(1, Math.min(5, Math.round(priority))) : 3,
      },
    });
  }
  return out.sort((a, b) => a.action.priority - b.action.priority).slice(0, 5);
}

export type MetricWindow = {
  metricKey: MetricKey;
  value: number | null;
  windowDays: number;
  from: string;
  to: string;
  snapshot: Partial<Record<MetricKey, number | null>>;
};

export function toWindow(metricKey: MetricKey, metrics: Metric[], windowDays: number, from: Date, to: Date): MetricWindow {
  return {
    metricKey,
    value: metrics.find((m) => m.key === metricKey)?.value ?? null,
    windowDays,
    from: from.toISOString(),
    to: to.toISOString(),
    snapshot: Object.fromEntries(metrics.map((m) => [m.key, m.value])),
  };
}

export const measurementDueAt = (startedAt: Date, windowDays: number) => new Date(startedAt.getTime() + windowDays * 86_400_000);
export const isMeasurementDue = (startedAt: Date, windowDays: number, now = new Date()) => now >= measurementDueAt(startedAt, windowDays);

/** Neutral, deterministic summary; deliberately makes no causal claim. */
export function resultNote(before: MetricWindow, after: MetricWindow) {
  const label = before.metricKey;
  if (before.value == null || after.value == null) {
    return `${label}: not enough measured data in one of the two ${before.windowDays}-day windows to compare. Nothing can be concluded.`;
  }
  const delta = after.value - before.value;
  const direction = delta === 0 ? 'was unchanged' : delta > 0 ? `rose by ${Math.round(delta * 10) / 10}` : `fell by ${Math.round(-delta * 10) / 10}`;
  return `${label} ${direction} (${before.value} → ${after.value}) between the ${before.windowDays} days before and the ${after.windowDays} days after this experiment started. This is a correlation only: other factors may explain the change.`;
}
