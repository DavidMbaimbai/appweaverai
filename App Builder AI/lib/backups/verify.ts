export type RowCounts = Record<string, number>;

export type RowCountMismatch = { table: string; expected: { min: number; max: number }; actual: number | null };

/**
 * Compares restored table row counts with the counts captured around the dump. A live database can change while
 * pg_dump runs, so each expected entry is a [min, max] window (equal values for a quiet database).
 */
export function compareRowCounts(
  before: RowCounts,
  after: RowCounts,
  restored: RowCounts,
): RowCountMismatch[] {
  const mismatches: RowCountMismatch[] = [];
  for (const table of Object.keys(before)) {
    const a = before[table];
    const b = after[table] ?? a;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    const actual = restored[table] ?? null;
    if (actual === null || actual < min || actual > max) {
      mismatches.push({ table, expected: { min, max }, actual });
    }
  }
  return mismatches;
}

/** Tables must exist and hold data for a restore to count as meaningful (guards against an empty dump). */
export function totalRows(counts: RowCounts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}
