import { getDatabaseBinding } from '@/db';
import { createJournalStore } from '@/lib/ltp-agent/journal-store';
import { monthlyReport } from '@/lib/ltp-agent/reports';
import { istDate } from '@/lib/ltp/time';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET ?month=YYYY-MM: the monthly readiness report (paper results only).
export async function GET(request: Request) {
  try {
    const month = new URL(request.url).searchParams.get('month') ?? istDate(Math.floor(Date.now() / 1000)).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: 'month must be YYYY-MM.' }, { status: 400, headers: NO_STORE });
    return Response.json(await monthlyReport(createJournalStore(getDatabaseBinding()), month), { headers: NO_STORE });
  } catch (error) {
    console.error('ltp agent report failed', error);
    return Response.json({ error: 'Unable to build the report.' }, { status: 500, headers: NO_STORE });
  }
}
