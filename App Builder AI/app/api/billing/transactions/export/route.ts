import { NextResponse } from 'next/server';

import { getCachedSession } from '@/lib/auth/cached';
import { ledgerToCsv, loadUnifiedLedger } from '@/lib/credits/unified-ledger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = (await getCachedSession())?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const entries = await loadUnifiedLedger(userId, { limit: 5000 });
  return new NextResponse(ledgerToCsv(entries), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="credit-transactions.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
