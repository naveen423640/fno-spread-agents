import { assertPaperOnly } from '@/lib/execution-mode';
import { buildConfig, NO_STORE } from '@/lib/screener/api';
import { liveBrokerName, liveConnected } from '@/lib/screener/runtime';

// Read-only: reports the defaults, the sources and whether the live broker connection is present (never the token).
export async function GET(request: Request) {
  try {
    assertPaperOnly();
    return Response.json(buildConfig({ liveBroker: liveBrokerName(), liveConnected: liveConnected(request) }), { headers: NO_STORE });
  } catch (error) {
    console.error('screener config failed', error);
    return Response.json({ error: 'Unable to read the screener configuration.' }, { status: 500, headers: NO_STORE });
  }
}
