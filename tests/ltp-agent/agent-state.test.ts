import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { agentStep, agentReplayDay } from '@/lib/ltp-agent/agent';
import { buildAgentState } from '@/lib/ltp-agent/state';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { writerBreakeven } from '@/lib/ltp/extensions';
import { istTs } from '@/lib/ltp/time';
import { DAY, freshStores, minutes, pathDay, U } from '../support/ltp-agent-day';
import { seedClosedTrades } from '../support/ltp-agent-journal';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const none = new Set<string>();
const WINNER: [string, number][] = [['10:00', 23880], ['10:01', 23862], ['10:02', 23900], ['10:03', 24100], ['10:04', 24275]];
const NOW = istTs(DAY, '10:06');

async function replayed(path: [string, number][] = WINNER) {
  const stores = freshStores();
  for (const s of pathDay(path)) await stores.store.insertSnapshot(s);
  await agentReplayDay({ ...stores, strategy: v01, paused: false, method: writerBreakeven }, U, DAY);
  return stores;
}

describe('buildAgentState: what the Agent tab shows', () => {
  it('header: the version, the phase counter, the heartbeat and the pause switch', async () => {
    const { store, journal } = await replayed();
    await journal.setState('active_version', '0.1'); // the replayed trades were made under v0.1
    await journal.setState('heartbeat_ts', String(NOW - 30));
    await journal.setState('paused', 'true');
    const s = await buildAgentState({ store, journal, holidays: none }, { nowTs: NOW });
    expect(s.header).toMatchObject({ activeVersion: '0.1', closedTrades: 1, paused: true, heartbeatAgeSeconds: 30, heartbeat: 'green' });
    expect(s.header.phase).toEqual({ phase: 'journal', counter: 'Journal phase: 1 / 100 trades', unlocked: false });
    expect(s.experimentsLocked).toBe(true);
  });
  it('no heartbeat yet reads as red', async () => {
    const { store, journal } = freshStores();
    const s = await buildAgentState({ store, journal, holidays: none }, { nowTs: NOW });
    expect(s.header).toMatchObject({ heartbeatAgeSeconds: null, heartbeat: 'red', paused: false, closedTrades: 0 });
  });
  it('today: a closed trade with its why sentence, entry, stop, target and both books\' result', async () => {
    const { store, journal } = await replayed();
    const s = await buildAgentState({ store, journal, holidays: none }, { nowTs: NOW });
    expect(s.today.open).toEqual([]);
    expect(s.today.closed).toHaveLength(1);
    const t = s.today.closed[0];
    expect(t.reason).toMatch(/^LONG NIFTY: COA-1 scenario 1/);
    expect(t).toMatchObject({ underlying: U, setup: 'coa1_reversal', direction: 'long', entry: 23862, stop: 23765, target: 24255 });
    expect(t.books.buy).toMatchObject({ status: 'closed', exitReason: 'target', fillQuality: 'quote' });
    expect(t.books.sell).toMatchObject({ status: 'closed', exitReason: 'target' });
    expect(typeof t.books.buy?.netPnl).toBe('number');
  });
  it('today: an open trade shows its live mark-to-market and fill quality', async () => {
    const stores = freshStores();
    for (const s of pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23900]])) await stores.store.insertSnapshot(s);
    const ctx = { ...stores, strategy: v01, paused: false, method: writerBreakeven };
    for (const t of minutes('09:15', '10:02')) await agentStep(ctx, U, istTs(DAY, t));
    const s = await buildAgentState({ ...stores, holidays: none }, { nowTs: istTs(DAY, '10:02', 20) });
    expect(s.today.closed).toEqual([]);
    expect(s.today.open).toHaveLength(1);
    expect(s.today.open[0].books.buy).toMatchObject({ status: 'open', fillQuality: 'quote' });
    expect(typeof s.today.open[0].books.buy?.mtm).toBe('number');
    expect(typeof s.today.open[0].books.sell?.mtm).toBe('number');
  });
  it('today: skipped signals are listed with the first rule that failed and the sentence', async () => {
    const stores = freshStores();
    for (const s of pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23890], ['10:03', 23862]])) await stores.store.insertSnapshot(s);
    await agentReplayDay({ ...stores, strategy: v01, paused: false, method: writerBreakeven }, U, DAY);
    const s = await buildAgentState({ ...stores, holidays: none }, { nowTs: NOW });
    expect(s.today.skipped).toHaveLength(1);
    expect(s.today.skipped[0]).toMatchObject({ skipReason: 'max_concurrent', underlying: U, direction: 'long' });
    expect(s.today.skipped[0].reason).toMatch(/^SKIPPED LONG NIFTY: a trade is already open/);
  });
  it('performance: equity curves per book and per version, the buy-versus-sell comparison and the breakdowns', async () => {
    const { store, journal } = freshStores();
    await seedClosedTrades(journal, { n: 6, days: ['2026-10-01', '2026-10-02'], version: '0.1', net: (i) => ({ buy: i % 2 ? -10 : 30, sell: 5 }) });
    await seedClosedTrades(journal, { n: 4, days: ['2026-10-05'], version: '0.2', net: () => ({ buy: 20, sell: -5 }) });
    const s = await buildAgentState({ store, journal, holidays: none }, { nowTs: NOW });
    expect(s.performance.equity.buy.at(-1)?.equity).toBe(3 * 30 - 3 * 10 + 4 * 20);
    expect(s.performance.equity.sell).toHaveLength(10);
    expect(Object.keys(s.performance.byVersion).sort()).toEqual(['0.1', '0.2']);
    expect(s.performance.byVersion['0.2'].buy.at(-1)?.equity).toBe(80);
    expect(s.performance.buyVsSell.buy).toMatchObject({ n: 10, net: 140 });
    expect(s.performance.buyVsSell.sell).toMatchObject({ n: 10, net: 10 });
    expect(Object.keys(s.performance.breakdowns.bySetup)).toEqual(['coa1_reversal']);
  });
  it('experiments stay locked below 100 and unlock at exactly 100', async () => {
    const { store, journal } = freshStores();
    await journal.setState('active_version', '0.1'); // the seeded trades are v0.1's
    await seedClosedTrades(journal, { n: 99, days: ['2026-10-01'] });
    expect((await buildAgentState({ store, journal, holidays: none }, { nowTs: NOW })).experimentsLocked).toBe(true);
    await seedClosedTrades(journal, { n: 1, days: ['2026-10-02'] });
    const s = await buildAgentState({ store, journal, holidays: none }, { nowTs: NOW });
    expect(s.experimentsLocked).toBe(false);
    expect(s.header.phase.counter).toBe('Learning phase');
  });
  it('watch: where the agent would trade now, from the latest snapshot of each underlying, nearest level first', async () => {
    const stores = await replayed();
    const s = await buildAgentState({ ...stores, holidays: none }, { nowTs: NOW });
    expect(s.watch).toHaveLength(1); // only NIFTY has data
    const w = s.watch[0];
    expect(w).toMatchObject({ underlying: U, spot: 24275, scenario: expect.any(Number), asOf: istTs(DAY, '10:04') });
    expect(w.levels.length).toBeGreaterThan(0);
    const distances = w.levels.map((l) => Math.abs(l.distance));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(w.levels[0]).toMatchObject({ direction: expect.stringMatching(/long|short/), stop: expect.any(Number), target: expect.any(Number), wouldTrade: expect.any(Boolean) });
  });
  it('watch: nothing recorded means nothing to watch', async () => {
    const { store, journal } = freshStores();
    expect((await buildAgentState({ store, journal, holidays: none }, { nowTs: NOW })).watch).toEqual([]);
  });
  it('a day with nothing on it is a valid, empty state', async () => {
    const { store, journal } = freshStores();
    const s = await buildAgentState({ store, journal, holidays: none }, { nowTs: NOW });
    expect(s.today).toEqual({ date: DAY, open: [], closed: [], skipped: [] });
    expect(s.watch).toEqual([]);
    expect(s.performance.equity).toEqual({ buy: [], sell: [] });
  });
});
