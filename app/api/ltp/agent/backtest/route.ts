import { getDatabaseBinding } from '@/db';
import { runBacktest } from '@/lib/ltp-agent/backtest';
import { resolveBacktestStrategy } from '@/lib/ltp-agent/backtest-strategy';
import { createJournalStore } from '@/lib/ltp-agent/journal-store';
import { TUNABLE_FIELDS } from '@/lib/ltp-agent/strategy';
import { DEFAULT_VERSION } from '@/lib/ltp-agent/default-version';
import { listVersions } from '@/lib/ltp-agent/versions';
import type { SessionAnalysis } from '@/lib/ltp/analyze';
import { UNDERLYINGS } from '@/lib/ltp/recorder';
import { createLtpStore } from '@/lib/ltp/store';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_DAYS = 5;

// GET ?list=1: the recorded days, the strategy versions, the agent's experiments and the tunable fields, for the pickers.
// GET ?from=&to= (or ?day=) with optional &version=, &experiment=EXP-###, &overrides={json of tunable fields}, &compare=1: replays those recorded days
// through that strategy into a throwaway in-memory journal and returns what the agent would have traded. With compare=1 the active version is replayed
// too and summarised beside it. Nothing is written to the live journal and FYERS is never called; trying a strategy never changes the active one.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const db = getDatabaseBinding();
    const store = createLtpStore(db);
    const journal = createJournalStore(db);
    const recorded = await store.recordedDays();
    if (params.get('list')) {
      const versions = await listVersions(journal);
      return Response.json({
        days: recorded, versions, activeVersion: versions.find((v) => v.active)?.version ?? DEFAULT_VERSION, tunables: TUNABLE_FIELDS,
        experiments: (await journal.listExperiments()).map((e) => ({ id: e.id, status: e.status, hypothesis: e.hypothesis, diff: e.diff, baseVersion: e.baseVersion })),
      }, { headers: NO_STORE });
    }
    const day = params.get('day');
    const from = params.get('from') ?? day;
    const to = params.get('to') ?? day;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return Response.json({ error: 'Give day=YYYY-MM-DD or from and to.' }, { status: 400, headers: NO_STORE });
    const days = recorded.filter((d) => d >= from && d <= to);
    if (days.length > MAX_DAYS) return Response.json({ error: `At most ${MAX_DAYS} days per run.` }, { status: 400, headers: NO_STORE });
    const asked = params.get('underlyings');
    const underlyings = asked ? asked.split(',').filter((u) => UNDERLYINGS.includes(u)) : undefined;
    if (asked && !underlyings?.length) return Response.json({ error: 'Choose at least one index.' }, { status: 400, headers: NO_STORE });
    let overrides: Record<string, unknown> | undefined;
    const rawOverrides = params.get('overrides');
    if (rawOverrides) {
      try { overrides = JSON.parse(rawOverrides) as Record<string, unknown>; } catch { return Response.json({ error: 'Invalid changes: not JSON.' }, { status: 400, headers: NO_STORE }); }
    }
    const { strategy, label } = await resolveBacktestStrategy(journal, { version: params.get('version') ?? undefined, experiment: params.get('experiment') ?? undefined, overrides });
    const cache = new Map<string, SessionAnalysis>();
    const result = await runBacktest({ store, strategy, days, underlyings, label, cache });
    if (!params.get('compare')) return Response.json(result, { headers: NO_STORE });
    const active = await resolveBacktestStrategy(journal, {});
    const baseline = await runBacktest({ store, strategy: active.strategy, days, underlyings, label: active.label, cache });
    return Response.json({ ...result, baseline: { label: baseline.label, summary: baseline.summary } }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    console.error('ltp backtest failed', error);
    return Response.json({ error: /^(No experiment|Invalid|Strategy version)/.test(message) ? message : 'The backtest failed.' }, { status: /^(No experiment|Invalid|Strategy version)/.test(message) ? 400 : 500, headers: NO_STORE });
  }
}
