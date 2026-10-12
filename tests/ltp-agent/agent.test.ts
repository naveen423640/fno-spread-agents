import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { agentReplayDay, agentStep, finishDay, type AgentContext } from '@/lib/ltp-agent/agent';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { writerBreakeven } from '@/lib/ltp/extensions';
import { istTs } from '@/lib/ltp/time';
import { chainAt, DAY, freshStores, minutes, pathDay, U } from '../support/ltp-agent-day';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const FLAT = minutes('09:15', '09:59');
// 09:15 to 09:59 flat at 24037, then the spots below: a touch of EOS (23860) at 10:01, up through EOR (24255) by 10:04.
const WINNER: [string, number][] = [['10:00', 23880], ['10:01', 23862], ['10:02', 23900], ['10:03', 24100], ['10:04', 24275], ['10:05', 24275], ['10:06', 24275]];

async function setup(snaps: ReturnType<typeof pathDay>, strategy = v01, paused = false) {
  const { store, journal } = freshStores();
  for (const s of snaps) await store.insertSnapshot(s);
  const ctx: AgentContext = { store, journal, strategy, paused, method: writerBreakeven };
  return { store, journal, ctx };
}
const outcomes = async (journal: ReturnType<typeof freshStores>['journal']) => (await journal.outcomesForDay(DAY)).map((o) => [o.book, o.outcome.exitReason]);

describe('a clean touch of EOS', () => {
  it('journals one taken decision with its rule trace and reason, books both books, and exits both on the target', async () => {
    const { ctx, journal } = await setup(pathDay(WINNER));
    await agentReplayDay(ctx, U, DAY);
    const decisions = await journal.decisionsForDay(DAY);
    expect(decisions).toHaveLength(1);
    const d = decisions[0];
    expect(d).toMatchObject({ taken: true, skipReason: null, setup: 'coa1_reversal', direction: 'long', book: 'both', strategyVersion: '0.1', ts: istTs(DAY, '10:01') });
    expect(d.reason).toMatch(/^LONG NIFTY: COA-1 scenario 1 \(Strong\/Strong; directions neutral\/neutral\); spot 23,862 touched EOS 23,860/);
    expect(d.trace.map((s) => s.rule)).toHaveLength(10);
    expect(d.expectation).toMatchObject({ entry: 23862, stop: 23765, target: 24255 });
    expect(d.context).toMatchObject({ spot: 23862, scenario: 1, hhmm: '10:01' });
    expect(await outcomes(journal)).toEqual([['buy', 'target'], ['sell', 'target']]);
    expect((await journal.outcomesForDay(DAY))[0].decisionId).toBe(d.decisionId);
  });
  it('the context carries what the brief lists: strengths, COA 2.0, SOC, diversions, the 9:20 lines, the weekly range and expiry days', async () => {
    const { ctx, journal } = await setup(pathDay(WINNER));
    await agentReplayDay(ctx, U, DAY);
    const c = (await journal.decisionsForDay(DAY))[0].context as Record<string, unknown>;
    for (const key of ['spot', 'line', 'support', 'resistance', 'scenario', 'coa2', 'soc', 'diversions', 'lines0920', 'weekly', 'hit', 'minutesSinceShift', 'hhmm', 'daysToExpiry', 'method']) expect(c).toHaveProperty(key);
    expect(c.daysToExpiry).toBe(1);
    expect(c.support).toMatchObject({ strike: 23900, status: 'strong' });
    expect(c.graph).toMatchObject({ pair: 'S|S', top: 'EOR', bottom: 'EOS', consistent: true, label: expect.stringMatching(/^1\(S\d+~?\/R\d+~?\)$/) });
    expect(c.conditions).toMatchObject({ support: { number: expect.any(Number), pressure: 'S' }, resistance: { number: expect.any(Number), pressure: 'S' } });
  });
  it('both books carry the decision id and the planned risk', async () => {
    const { ctx, journal } = await setup(pathDay(WINNER.slice(0, 2)));
    await agentReplayDay(ctx, U, DAY);
    const d = (await journal.decisionsForDay(DAY))[0];
    const open = await journal.openTrades(U, DAY);
    expect(open).toHaveLength(0); // finishDay closed them: the day ended with the trade open
    expect(await outcomes(journal)).toEqual([['buy', 'data_gap'], ['sell', 'data_gap']]);
    expect(d.expectation).toHaveProperty('perBook');
  });
  it('running the same minute twice adds nothing', async () => {
    const { ctx, journal } = await setup(pathDay(WINNER.slice(0, 2)));
    const ts = istTs(DAY, '10:01');
    await agentStep(ctx, U, istTs(DAY, '10:00'));
    const first = await agentStep(ctx, U, ts);
    const again = await agentStep(ctx, U, ts);
    expect(first.opened).toBe(2);
    expect(again).toEqual({ decisions: 0, opened: 0, closed: 0 });
    expect(await journal.decisionsForDay(DAY)).toHaveLength(1);
  });
});

describe('the agent never writes to the snapshot store (replay opens it read-only)', () => {
  it('a full replay works when every write method of the snapshot store throws', async () => {
    const { store, journal } = await setup(pathDay(WINNER));
    const readOnly = new Proxy(store, { get: (target, key: string) => (/^(save|add|insert)/.test(key) ? () => { throw new Error(`the agent tried to write to the snapshot store: ${key}`); } : (target as never)[key]) });
    await expect(agentReplayDay({ store: readOnly, journal, strategy: v01, paused: false, method: writerBreakeven }, U, DAY)).resolves.toBeUndefined();
    expect(await journal.decisionsForDay(DAY)).toHaveLength(1);
  });
});

describe('exits', () => {
  it('the stop: price falls through the stop line', async () => {
    const { ctx, journal } = await setup(pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23800], ['10:03', 23700]]));
    await agentReplayDay(ctx, U, DAY);
    expect(await outcomes(journal)).toEqual([['buy', 'stop'], ['sell', 'stop']]);
  });
  it('a position still open at 15:15 is closed on the time exit', async () => {
    const { ctx, journal } = await setup([...pathDay([['10:00', 23880], ['10:01', 23862]]), ...minutes('10:02', '15:20').map((t) => chainAt(t, 23900))]);
    await agentReplayDay(ctx, U, DAY);
    const rows = await journal.outcomesForDay(DAY);
    expect(rows.map((o) => o.outcome.exitReason)).toEqual(['time', 'time']);
    expect(rows[0].outcome.closedTs).toBe(istTs(DAY, '15:15'));
  }, 60_000);
  it('a missing minute while a trade is open closes it as a data gap, at the first snapshot after the gap', async () => {
    const snaps = [...pathDay([['10:00', 23880], ['10:01', 23862]]), chainAt('10:03', 23890)];
    const { ctx, journal } = await setup(snaps);
    await agentReplayDay(ctx, U, DAY);
    const rows = await journal.outcomesForDay(DAY);
    expect(rows.map((o) => o.outcome.exitReason)).toEqual(['data_gap', 'data_gap']);
    expect(rows[0].outcome.closedTs).toBe(istTs(DAY, '10:03'));
  });
});

describe('pause, caps and unusable states', () => {
  it('paused: no new trades and no decisions, but an open trade is still managed to its exit', async () => {
    const { store, journal, ctx } = await setup(pathDay(WINNER.slice(0, 2)));
    await agentStep(ctx, U, istTs(DAY, '10:01')); // opens
    for (const s of [chainAt('10:02', 23900), chainAt('10:03', 24100), chainAt('10:04', 24275)]) await store.insertSnapshot(s);
    for (const t of ['10:02', '10:03', '10:04']) await agentStep({ ...ctx, paused: true }, U, istTs(DAY, t));
    expect(await outcomes(journal)).toEqual([['buy', 'target'], ['sell', 'target']]);
    expect(await journal.decisionsForDay(DAY)).toHaveLength(1);
  });
  it('a paused agent journals nothing even at a touch', async () => {
    const { ctx, journal } = await setup(pathDay(WINNER.slice(0, 2)), v01, true);
    await agentReplayDay(ctx, U, DAY);
    expect(await journal.decisionsForDay(DAY)).toEqual([]);
  });
  it('the daily trade cap is judged before concurrency: with a cap of 1, a re-touch is skipped on the cap', async () => {
    const strategy = { ...v01, risk: { ...v01.risk, max_trades_per_day: 1 } };
    const { ctx, journal } = await setup(pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23890], ['10:03', 23862]]), strategy);
    await agentReplayDay(ctx, U, DAY);
    const ds = await journal.decisionsForDay(DAY);
    expect(ds.map((d) => [d.taken, d.skipReason])).toEqual([[true, null], [false, 'daily_trade_cap']]);
  });
  it('one open trade per underlying: a re-touch while it is still open is skipped on max_concurrent', async () => {
    const path: [string, number][] = [['10:00', 23880], ['10:01', 23862], ['10:02', 23890], ['10:03', 23862]];
    const { ctx, journal } = await setup(pathDay(path));
    await agentReplayDay(ctx, U, DAY);
    const ds = await journal.decisionsForDay(DAY);
    expect(ds.map((d) => [d.taken, d.skipReason])).toEqual([[true, null], [false, 'max_concurrent']]);
    expect(ds[1].trace.find((s) => s.rule === 'hit_number')?.inputs).toMatchObject({ hit: 2 });
  });
  it('a day with no usable levels does nothing and does not crash', async () => {
    const { ctx, journal } = await setup([chainAt('10:00', 10)]);
    await expect(agentReplayDay(ctx, U, DAY)).resolves.toBeUndefined();
    expect(await journal.decisionsForDay(DAY)).toEqual([]);
  });
});

describe('finishDay', () => {
  it('closes anything still open at the last snapshot of the day, flagged as a data gap', async () => {
    const { ctx, journal } = await setup(pathDay(WINNER.slice(0, 2)));
    for (const t of minutes('09:15', '10:01')) await agentStep(ctx, U, istTs(DAY, t));
    expect(await journal.openTrades(U, DAY)).toHaveLength(2);
    expect(await finishDay(ctx, U, DAY)).toBe(2);
    expect(await journal.openTrades(U, DAY)).toHaveLength(0);
  });
});

describe('live and replay are the same code path', () => {
  it('feeding a day minute by minute as it is recorded gives the same decisions and outcomes as replaying it afterwards', async () => {
    const snaps = pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23890], ['10:03', 23862], ['10:04', 24000], ['10:05', 24100], ['10:06', 24275]]);
    const live = freshStores();
    const liveCtx: AgentContext = { ...live, strategy: v01, paused: false, method: writerBreakeven };
    for (const s of snaps) { await live.store.insertSnapshot(s); await agentStep(liveCtx, U, s.ts); }
    await finishDay(liveCtx, U, DAY);
    const replayed = await setup(snaps);
    await agentReplayDay(replayed.ctx, U, DAY);
    expect(await live.journal.decisionsForDay(DAY)).toEqual(await replayed.journal.decisionsForDay(DAY));
    expect(await live.journal.outcomesForDay(DAY)).toEqual(await replayed.journal.outcomesForDay(DAY));
    expect((await live.journal.decisionsForDay(DAY)).length).toBeGreaterThan(1);
  });
});

void FLAT;
