import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { probeOptionData } from '@/lib/vwap/option-probe';
import { assertPaperOnly } from '@/lib/execution-mode';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Checks what real option data FYERS serves for an at-the-money Nifty call and put: the option chain fields, and 5-minute and daily
// candles with open interest. Read-only; about 5 requests; uses your FYERS login. Nothing is stored.
export async function GET(request: Request) {
  try {
    assertPaperOnly();
    const credentials = fyersCredentials(request);
    if (!credentials) return Response.json({ loginRequired: true, error: 'Connect FYERS first.' }, { status: 401, headers: NO_STORE });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const result = await probeOptionData({ credentials, today });
    if (result.loginRequired) return Response.json({ loginRequired: true, error: 'The FYERS login has expired. Sign in again.' }, { status: 401, headers: NO_STORE });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('option probe failed', error);
    return Response.json({ error: 'The probe failed.' }, { status: 500, headers: NO_STORE });
  }
}
