import { getDatabaseBinding } from '@/db';
import { checkRequestOrigin } from '@/lib/agent-service/guard';
import { createD1AgentStore } from '@/lib/agents/store';
import { createJournalStore } from '@/lib/ltp-agent/journal-store';
import { buildReviewerLlm, DEFAULT_REVIEW_MODEL, reviewDay } from '@/lib/ltp-agent/reviewer';
import { createLtpStore } from '@/lib/ltp/store';
import { istDate } from '@/lib/ltp/time';

const NO_STORE = { 'Cache-Control': 'no-store' };

// POST { date?: 'YYYY-MM-DD' }: reviews that day's closed trades with the Anthropic model from AGENT_REVIEW_MODEL (or the default). Without
// ANTHROPIC_API_KEY it reviews nothing and says so. The review is stored beside the trade; it never touches the decision record.
export async function POST(request: Request) {
  try {
    const blocked = checkRequestOrigin(request.headers);
    if (blocked) return Response.json({ error: blocked }, { status: 403, headers: NO_STORE });
    const body = (await request.json().catch(() => null)) as { date?: unknown } | null;
    const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : istDate(Math.floor(Date.now() / 1000));
    const db = getDatabaseBinding();
    const llm = buildReviewerLlm(process.env, createD1AgentStore(db).logLlmCall);
    const result = await reviewDay({ store: createLtpStore(db), journal: createJournalStore(db), llm, model: llm?.model ?? DEFAULT_REVIEW_MODEL }, date);
    return Response.json({ date, ...result }, { headers: NO_STORE });
  } catch (error) {
    console.error('ltp agent review failed', error);
    return Response.json({ error: 'The review run failed.' }, { status: 500, headers: NO_STORE });
  }
}
