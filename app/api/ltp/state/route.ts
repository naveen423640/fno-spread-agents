import { getDatabaseBinding } from '@/db';
import { UNDERLYINGS } from '@/lib/ltp/recorder';
import { buildState } from '@/lib/ltp/state';
import { createLtpStore } from '@/lib/ltp/store';
import { HOLIDAYS } from '@/lib/screener/holidays';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET /api/ltp/state?underlying=&date=&method= : everything the tab shows, read from the store only. It never calls FYERS.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const underlying = params.get('underlying') ?? UNDERLYINGS[0];
    if (!UNDERLYINGS.includes(underlying)) return Response.json({ error: 'Unknown underlying.' }, { status: 400, headers: NO_STORE });
    const date = params.get('date') ?? undefined;
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'date must be YYYY-MM-DD.' }, { status: 400, headers: NO_STORE });
    const state = await buildState(createLtpStore(getDatabaseBinding()), {
      underlying, date, method: params.get('method') ?? undefined, nowTs: Math.floor(Date.now() / 1000), holidays: HOLIDAYS,
    });
    return Response.json(state, { headers: NO_STORE });
  } catch (error) {
    console.error('ltp state failed', error);
    return Response.json({ error: 'Unable to read the LTP state.' }, { status: 500, headers: NO_STORE });
  }
}
