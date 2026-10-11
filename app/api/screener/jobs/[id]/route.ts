import { jobView, NO_STORE } from '@/lib/screener/api';
import { buildScreenerDeps } from '@/lib/screener/runtime';

type Context = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const job = await (await buildScreenerDeps(request)).store.getJob(id);
    if (!job) return Response.json({ error: 'Job not found.' }, { status: 404, headers: NO_STORE });
    return Response.json(jobView(job), { headers: NO_STORE });
  } catch (error) {
    console.error('screener job read failed', error);
    return Response.json({ error: 'Unable to read the job.' }, { status: 500, headers: NO_STORE });
  }
}
