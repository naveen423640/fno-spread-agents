import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { fyersCredentials } from '@/lib/backtest/fyers-data';
import { assertPaperOnly } from '@/lib/execution-mode';
import { sendTokenToCloud } from '@/lib/ltp/cloud-token';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST: forwards the FYERS token this browser is logged in with to the cloud recorder (LTP_RECORDER_URL, LTP_RECORDER_SECRET from the environment).
// The answer says only whether it worked; neither the token nor the secret is ever returned.
export async function POST(request: Request) {
  try {
    assertPaperOnly();
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const result = await sendTokenToCloud({ accessToken: fyersCredentials(request)?.accessToken, url: process.env.LTP_RECORDER_URL, secret: process.env.LTP_RECORDER_SECRET });
    return result.ok ? Response.json({ ok: true }, { headers: NO_STORE }) : Response.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  } catch (error) {
    console.error('ltp cloud-token failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Unable to send the token.' }, { status: 500, headers: NO_STORE });
  }
}
