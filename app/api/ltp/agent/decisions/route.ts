import { getDatabaseBinding } from '@/db';
import { createJournalStore } from '@/lib/ltp-agent/journal-store';
import { buildReviewInput } from '@/lib/ltp-agent/reviewer';
import { createLtpStore } from '@/lib/ltp/store';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET ?q=text: the latest decisions (taken and skipped), filtered by a word in the reason, rule, setup, underlying or day.
// GET ?id=decision: one decision in full: the rule trace, the outcomes, the review and the path during the trade.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const db = getDatabaseBinding();
    const journal = createJournalStore(db);
    const id = params.get('id');
    if (id) {
      const decision = await journal.decisionById(id);
      if (!decision) return Response.json({ error: 'No such decision.' }, { status: 404, headers: NO_STORE });
      const outcomes = await journal.outcomesForDecision(id);
      const path = outcomes.length ? (await buildReviewInput({ store: createLtpStore(db), journal }, id)).path : [];
      return Response.json({ decision, outcomes, review: await journal.reviewFor(id), path }, { headers: NO_STORE });
    }
    const q = (params.get('q') ?? '').trim().toLowerCase();
    const all = await journal.recentDecisions(500);
    const rows = (q ? all.filter((d) => [d.reason, d.skipReason ?? '', d.setup, d.underlying, d.tradeDate, d.direction, d.taken ? 'taken' : 'skipped'].join(' ').toLowerCase().includes(q)) : all).slice(0, 200);
    return Response.json({ decisions: rows.map((d) => ({ decisionId: d.decisionId, ts: d.ts, tradeDate: d.tradeDate, underlying: d.underlying, setup: d.setup, direction: d.direction, taken: d.taken, skipReason: d.skipReason, reason: d.reason, version: d.strategyVersion })) }, { headers: NO_STORE });
  } catch (error) {
    console.error('ltp agent decisions failed', error);
    return Response.json({ error: 'Unable to read the journal.' }, { status: 500, headers: NO_STORE });
  }
}
