import { handleRequest, runScheduled, type Env } from './handler';

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handleRequest(request, env); } catch (error) {
      console.error('recorder request failed', error instanceof Error ? error.message : 'unknown');
      return Response.json({ error: 'The recorder failed.' }, { status: 500 });
    }
  },
  async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
    const summary = await runScheduled(env, new Date(controller.scheduledTime));
    console.log(JSON.stringify({ minuteTs: summary.minuteTs, skipped: summary.skipped, results: summary.results.map((r) => ({ u: r.underlying.split(':')[1], inserted: r.inserted, gap: r.gap, skipped: r.skipped })) }));
  },
};

export default worker;
