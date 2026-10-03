import { buildReadStore } from '@/lib/agent-service/runtime';

const headers = { 'Cache-Control': 'no-store' };

type Context = { params: Promise<{ id: string }> | { id: string } };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const run = await buildReadStore().getRun(id);
    if (!run) return Response.json({ error: 'Run not found.' }, { status: 404, headers });
    return Response.json(run, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to read the run.' }, { status: 500, headers });
  }
}
