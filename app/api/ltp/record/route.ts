import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { assertPaperOnly } from '@/lib/execution-mode';
import { LTP_CONFIG } from '@/lib/ltp/config';
import { health, recordOnce, UNDERLYINGS } from '@/lib/ltp/recorder';
import { createLtpStore } from '@/lib/ltp/store';
import { createFyersAdapter } from '@/lib/screener/broker/fyers';
import { HOLIDAYS } from '@/lib/screener/holidays';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET: recorder health from the store (no FYERS call). POST: records one snapshot per underlying for the current minute. Read-only market data;
// the FYERS login is the app's existing one (cookie, or FYERS_ACCESS_TOKEN in the environment, which is what the background runner uses).
export async function GET() {
  try {
    return Response.json(await health(createLtpStore(getDatabaseBinding()), Math.floor(Date.now() / 1000), UNDERLYINGS, HOLIDAYS), { headers: NO_STORE });
  } catch (error) {
    console.error('ltp health failed', error);
    return Response.json({ error: 'Unable to read the recorder health.' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const credentials = fyersCredentials(request);
    if (!credentials) return Response.json({ loginRequired: true, error: 'Connect FYERS first, or set FYERS_ACCESS_TOKEN for the background runner.' }, { status: 401, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as { force?: unknown; underlyings?: unknown } | null;
    const wanted = Array.isArray(body?.underlyings) ? UNDERLYINGS.filter((u) => (body!.underlyings as unknown[]).includes(u)) : UNDERLYINGS;
    const summary = await recordOnce({
      adapter: createFyersAdapter({ credentials }), store: createLtpStore(getDatabaseBinding()), now: () => new Date(),
      underlyings: wanted, strikecount: LTP_CONFIG.strikecount, holidays: HOLIDAYS, force: body?.force === true,
    });
    const allLoginFailed = summary.results.length > 0 && summary.results.every((r) => r.gap === 'login_required');
    return Response.json(summary, { status: allLoginFailed ? 401 : 200, headers: NO_STORE });
  } catch (error) {
    console.error('ltp record failed', error);
    return Response.json({ error: 'Unable to record a snapshot.' }, { status: 500, headers: NO_STORE });
  }
}
