import { latestView, NO_STORE } from '@/lib/screener/api';
import { buildScreenerDeps } from '@/lib/screener/runtime';

// The newest finished scan for a source. Reading it starts no work; start one with POST /api/screener/jobs.
export async function GET(request: Request) {
  try {
    const view = await latestView(await buildScreenerDeps(request), 'scan', new URL(request.url).searchParams.get('source'));
    if (view.status === 'error') return Response.json({ error: view.error }, { status: view.httpStatus, headers: NO_STORE });
    return Response.json(view, { headers: NO_STORE });
  } catch (error) {
    console.error('screener scan read failed', error);
    return Response.json({ error: 'Unable to read the latest scan.' }, { status: 500, headers: NO_STORE });
  }
}
