import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { probeOptionData } from '@/lib/vwap/option-probe';
import { assertPaperOnly } from '@/lib/execution-mode';

const NO_STORE = { 'Cache-Control': 'no-store' };

// ?index=NSE:NIFTY50-INDEX (default) | NSE:NIFTYBANK-INDEX | BSE:SENSEX-INDEX picks the underlying.
// Checks what real option data FYERS serves for an at-the-money Nifty call and put: the option chain fields, and 5-minute and daily
// candles with open interest. Read-only; about 5 requests; uses your FYERS login. Nothing is stored.
export async function GET(request: Request) {
  try {
    assertPaperOnly();
    const credentials = fyersCredentials(request);
    if (!credentials) return Response.json({ loginRequired: true, error: 'Connect FYERS first.' }, { status: 401, headers: NO_STORE });
    const index = new URL(request.url).searchParams.get('index') ?? 'NSE:NIFTY50-INDEX';
    if (!/^(NSE|BSE):[A-Z0-9&-]{1,30}-INDEX$/.test(index)) return Response.json({ error: 'Unknown index.' }, { status: 400, headers: NO_STORE });
    const underlying = ({ 'NIFTY50': 'NIFTY', 'NIFTYBANK': 'BANKNIFTY' } as Record<string, string>)[index.replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '')] ?? index.replace(/^(NSE|BSE):/, '').replace(/-INDEX$/, '');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const result = await probeOptionData({ credentials, today, indexSymbol: index, underlying });
    if (result.loginRequired) return Response.json({ loginRequired: true, error: 'The FYERS login has expired. Sign in again.' }, { status: 401, headers: NO_STORE });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('option probe failed', error);
    return Response.json({ error: 'The probe failed.' }, { status: 500, headers: NO_STORE });
  }
}
