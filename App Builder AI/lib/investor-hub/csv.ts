import { INVESTOR_TYPES, type InvestorType } from './constants';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Quotes a cell and neutralises spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export type ImportedInvestor = {
  name: string;
  firm: string | null;
  email: string | null;
  website: string | null;
  type: InvestorType;
  tags: string[];
  linkedinUrl: string | null;
};

const COLUMNS: Record<string, keyof ImportedInvestor> = {
  name: 'name',
  investor: 'name',
  firm: 'firm',
  company: 'firm',
  email: 'email',
  website: 'website',
  url: 'website',
  type: 'type',
  tags: 'tags',
  linkedin: 'linkedinUrl',
  linkedinurl: 'linkedinUrl',
};

export const MAX_IMPORT_ROWS = 500;

/** Reads a CSV with a header row; rows without a name are skipped. */
export function parseInvestorCsv(text: string): ImportedInvestor[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const map = rows[0].map((h) => COLUMNS[h.trim().toLowerCase().replace(/[\s_-]/g, '')]);
  if (!map.includes('name')) return [];

  const out: ImportedInvestor[] = [];
  for (const row of rows.slice(1, MAX_IMPORT_ROWS + 1)) {
    const rec: Record<string, string> = {};
    map.forEach((key, i) => {
      if (key) rec[key] = (row[i] ?? '').trim().replace(/^'(?=[=+\-@])/, '');
    });
    if (!rec.name) continue;
    const type = (rec.type ?? '').toUpperCase().replace(/[\s-]/g, '_');
    out.push({
      name: rec.name.slice(0, 200),
      firm: rec.firm?.slice(0, 200) || null,
      email: rec.email || null,
      website: rec.website || null,
      type: (INVESTOR_TYPES as readonly string[]).includes(type) ? (type as InvestorType) : 'OTHER',
      tags: (rec.tags ?? '')
        .split(/[;|]/)
        .map((t) => t.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 10),
      linkedinUrl: rec.linkedinUrl || null,
    });
  }
  return out;
}
