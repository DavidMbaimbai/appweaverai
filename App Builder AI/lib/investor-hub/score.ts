export type ScoreProfile = {
  sector?: string | null;
  stage?: string | null;
  amountSought?: number | null;
  geography?: string | null;
  description?: string | null;
};

export type ScoreInvestor = {
  sectors?: string[] | null;
  stages?: string[] | null;
  geographies?: string[] | null;
  ticketMin?: number | null;
  ticketMax?: number | null;
  portfolio?: string[] | null;
};

export const SCORE_WEIGHTS = {
  sector: 30,
  stage: 25,
  ticket: 20,
  geography: 10,
  portfolio: 15,
} as const;

export type ScoreComponent = keyof typeof SCORE_WEIGHTS;

export type ScoreResult = {
  /** 0-100, or null when no factor could be evaluated. */
  score: number | null;
  components: Partial<Record<ScoreComponent, number>>;
  reasons: string[];
  missing: string[];
};

const ANY = /^(any|all|generalist|sector[\s-]?agnostic|agnostic|global|worldwide)$/i;
const STAGE_ORDER = ['idea', 'pre-seed', 'seed', 'series a', 'series b', 'growth'];

const clean = (values: string[] | null | undefined) =>
  (values ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean);

function normalizeStage(value: string): string {
  const v = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/pre\s?seed|angel/.test(v)) return 'pre-seed';
  if (/^seed|\bseed\b/.test(v)) return 'seed';
  if (/series\s?a|early/.test(v)) return 'series a';
  if (/series\s?b/.test(v)) return 'series b';
  if (/growth|late|series\s?[c-z]/.test(v)) return 'growth';
  if (/idea|concept|prototype/.test(v)) return 'idea';
  return v;
}

function overlaps(a: string, b: string) {
  return a.includes(b) || b.includes(a);
}

function words(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

function money(n: number) {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${+(n / 1_000).toFixed(1)}k` : String(n);
}

/** Pure, explainable fit score. Factors with missing data are skipped and reported, never guessed. */
export function scoreInvestor(profile: ScoreProfile, investor: ScoreInvestor): ScoreResult {
  const components: ScoreResult['components'] = {};
  const reasons: string[] = [];
  const missing: string[] = [];

  // Sector
  const sector = profile.sector?.trim().toLowerCase();
  const sectors = clean(investor.sectors);
  if (!sector) missing.push('Your company sector is not set.');
  else if (!sectors.length) missing.push('Investor sector focus is unknown.');
  else if (sectors.some((s) => ANY.test(s))) {
    components.sector = 0.6;
    reasons.push('Investor is sector-agnostic, so sector fit is possible but not specific.');
  } else {
    const hit = sectors.find((s) => overlaps(s, sector));
    components.sector = hit ? 1 : 0;
    reasons.push(
      hit ? `Sector match: investor lists "${hit}".` : `Sector mismatch: investor focuses on ${sectors.join(', ')}.`,
    );
  }

  // Stage
  const stage = profile.stage ? normalizeStage(profile.stage) : '';
  const stages = clean(investor.stages).map(normalizeStage);
  if (!stage) missing.push('Your company stage is not set.');
  else if (!stages.length) missing.push('Investor stage focus is unknown.');
  else if (stages.includes(stage)) {
    components.stage = 1;
    reasons.push(`Stage match: investor backs ${stage} companies.`);
  } else {
    const idx = STAGE_ORDER.indexOf(stage);
    const near = idx >= 0 && stages.some((s) => Math.abs(STAGE_ORDER.indexOf(s) - idx) === 1);
    components.stage = near ? 0.5 : 0;
    reasons.push(
      near
        ? `Adjacent stage: investor backs ${stages.join(', ')}, you are ${stage}.`
        : `Stage mismatch: investor backs ${stages.join(', ')}, you are ${stage}.`,
    );
  }

  // Ticket size
  const amount = profile.amountSought ?? null;
  const { ticketMin: min, ticketMax: max } = investor;
  if (amount == null) missing.push('Amount you are seeking is not set.');
  else if (min == null && max == null) missing.push('Investor ticket size is unknown.');
  else {
    const lo = min ?? 0;
    const hi = max ?? Number.POSITIVE_INFINITY;
    if (amount >= lo && amount <= hi) {
      components.ticket = 1;
      reasons.push(`Ticket fit: ${money(amount)} is within the investor's range.`);
    } else if (amount >= lo / 2 && amount <= hi * 2) {
      components.ticket = 0.4;
      reasons.push(`Ticket is close: ${money(amount)} is just outside the investor's range.`);
    } else {
      components.ticket = 0;
      reasons.push(`Ticket mismatch: ${money(amount)} is far outside the investor's range.`);
    }
  }

  // Geography
  const geography = profile.geography?.trim().toLowerCase();
  const geos = clean(investor.geographies);
  if (!geography) missing.push('Your geography is not set.');
  else if (!geos.length) missing.push('Investor geography is unknown.');
  else if (geos.some((g) => overlaps(g, geography))) {
    components.geography = 1;
    reasons.push('Geography match.');
  } else if (geos.some((g) => ANY.test(g))) {
    components.geography = 0.8;
    reasons.push('Investor invests globally.');
  } else {
    components.geography = 0;
    reasons.push(`Geography mismatch: investor focuses on ${geos.join(', ')}.`);
  }

  // Portfolio relevance
  const portfolio = investor.portfolio ?? [];
  const keywords = new Set(words(`${profile.sector ?? ''} ${profile.description ?? ''}`));
  if (!keywords.size) missing.push('Company description/sector too thin to judge portfolio relevance.');
  else if (!portfolio.length) missing.push('Investor portfolio is unknown.');
  else {
    const relevant = portfolio.filter((p) => words(p).some((w) => keywords.has(w)));
    components.portfolio = relevant.length >= 2 ? 1 : relevant.length === 1 ? 0.6 : 0;
    reasons.push(
      relevant.length
        ? `Portfolio relevance: ${relevant.slice(0, 3).join(', ')} look related to your space.`
        : 'No portfolio company clearly related to your space.',
    );
  }

  let total = 0;
  let weight = 0;
  for (const key of Object.keys(components) as ScoreComponent[]) {
    total += (components[key] ?? 0) * SCORE_WEIGHTS[key];
    weight += SCORE_WEIGHTS[key];
  }
  return { score: weight ? Math.round((total / weight) * 100) : null, components, reasons, missing };
}
