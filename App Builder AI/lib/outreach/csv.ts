import type { ImportedLead } from '@/lib/outreach/process';

function parseRows(text: string): string[][] {
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

const COLUMNS: Record<string, keyof ImportedLead> = {
  name: 'name',
  firm: 'firm',
  company: 'firm',
  focus: 'focus',
  email: 'email',
  phone: 'phone',
  url: 'sourceUrl',
  source: 'sourceUrl',
  sourceurl: 'sourceUrl',
  website: 'sourceUrl',
};

/** Parses a CSV with a header row (name, firm, focus, email, phone, url); rows without a name are dropped. */
export function parseLeadsCsv(text: string): ImportedLead[] {
  const [header, ...rows] = parseRows(text);
  if (!header) return [];
  const keys = header.map((h) => COLUMNS[h.trim().toLowerCase().replace(/[\s_-]/g, '')]);

  const leads: ImportedLead[] = [];
  for (const row of rows) {
    const lead: Partial<Record<keyof ImportedLead, string>> = {};
    keys.forEach((key, i) => {
      const value = row[i]?.trim();
      if (key && value) lead[key] = value.slice(0, 500);
    });
    if (lead.name) leads.push(lead as ImportedLead);
  }
  return leads;
}
