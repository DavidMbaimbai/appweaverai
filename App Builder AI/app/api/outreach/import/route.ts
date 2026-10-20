import { NextResponse } from 'next/server';
import { z } from 'zod';

import { sendAlert } from '@/lib/alerts';
import { parseLeadsCsv } from '@/lib/outreach/csv';
import { importLeads } from '@/lib/outreach/process';
import { hasBearerSecret } from '@/lib/rate-limit';

export const maxDuration = 300;

const leadSchema = z.object({
  name: z.string().min(1).max(200),
  firm: z.string().max(200).optional(),
  focus: z.string().max(500).optional(),
  email: z.string().max(254).optional(),
  phone: z.string().max(40).optional(),
  sourceUrl: z.string().max(500).optional(),
});

/** JSON body: { leads: [...] } or { csv: "name,firm,email,..." } (header row required). */
const schema = z.union([
  z.object({ leads: leadSchema.array().min(1).max(200) }),
  z.object({ csv: z.string().min(1).max(200_000) }),
]);

/** Import investors from your own list and draft their emails for approval. */
export async function POST(request: Request) {
  if (!hasBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const leads = 'csv' in parsed.data ? parseLeadsCsv(parsed.data.csv) : parsed.data.leads;
  if (!leads.length) {
    return NextResponse.json({ error: 'No valid rows (need a header with a name column).' }, { status: 400 });
  }

  try {
    return NextResponse.json({ success: true, ...(await importLeads(leads.slice(0, 200))) });
  } catch (error) {
    console.error('[outreach/import] failed:', error);
    await sendAlert('Investor import failed', String(error));
    return NextResponse.json({ error: 'Import failed.' }, { status: 500 });
  }
}
