export type BudgetLimits = { dayLimit?: number | null; weekLimit?: number | null; monthLimit?: number | null };
export type BudgetSpend = { day: number; week: number; month: number };
export type BudgetPeriod = 'day' | 'week' | 'month';

/** Returns the first period whose limit would be exceeded by `cost`, or null. */
export function evaluateBudget(limits: BudgetLimits, spent: BudgetSpend, cost: number): BudgetPeriod | null {
  const checks: Array<[BudgetPeriod, number | null | undefined]> = [
    ['day', limits.dayLimit],
    ['week', limits.weekLimit],
    ['month', limits.monthLimit],
  ];
  for (const [period, limit] of checks) {
    if (limit != null && spent[period] + cost > limit) return period;
  }
  return null;
}

export function periodStarts(now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const week = new Date(day);
  week.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { day, week, month };
}

/** Stable per-slot key so a retried scheduled job can never be billed or run twice. */
export function scheduleSlotKey(scheduleId: string, slot: Date | string, operation: string) {
  const at = typeof slot === 'string' ? slot : slot.toISOString();
  return `sched:${scheduleId}:${operation}:${at}`;
}
