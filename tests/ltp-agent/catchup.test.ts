import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { agentCatchUp, agentReplayDay, finishDay, type AgentContext } from '@/lib/ltp-agent/agent';
import { parseStrategy } from '@/lib/ltp-agent/strategy';
import { writerBreakeven } from '@/lib/ltp/extensions';
import { istTs } from '@/lib/ltp/time';
import { DAY, freshStores, pathDay, U } from '../support/ltp-agent-day';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const PATH: [string, number][] = [['10:00', 23880], ['10:01', 23862], ['10:02', 23890], ['10:03', 23862], ['10:04', 24000], ['10:05', 24100], ['10:06', 24275]];
const mem = () => { const m = new Map<string, string>(); return { getState: async (k: string) => m.get(k) ?? null, setState: async (k: string, v: string) => { m.set(k, v); } }; };

describe('agentCatchUp steps every recorded minute exactly once, in order, even when the recorder is late', () => {
  it('a recorder that stores the touch minute AFTER the agent first looked still gives the same journal as a replay', async () => {
    const snaps = pathDay(PATH);
    const live = freshStores();
    const state = mem();
    const ctx: AgentContext = { ...live, strategy: v01, paused: false, method: writerBreakeven };
    let late: (typeof snaps)[number] | null = null;
    for (const s of snaps) {
      if (s.ts === istTs(DAY, '10:01')) { late = s; continue; } // the recorder is slow this minute
      await live.store.insertSnapshot(s);
      if (late && s.ts === istTs(DAY, '10:02')) await live.store.insertSnapshot(late); // it shows up before the next call
      await agentCatchUp(ctx, state, U, s.ts + 6);
    }
    await finishDay(ctx, U, DAY);
    const replayed = freshStores();
    for (const s of snaps) await replayed.store.insertSnapshot(s);
    await agentReplayDay({ ...replayed, strategy: v01, paused: false, method: writerBreakeven }, U, DAY);
    expect(await live.journal.decisionsForDay(DAY)).toEqual(await replayed.journal.decisionsForDay(DAY));
    expect(await live.journal.outcomesForDay(DAY)).toEqual(await replayed.journal.outcomesForDay(DAY));
    expect((await live.journal.decisionsForDay(DAY)).length).toBeGreaterThan(0);
  });
  it('calling again for the same minute does nothing, and the last processed minute is remembered', async () => {
    const stores = freshStores();
    for (const s of pathDay(PATH.slice(0, 2))) await stores.store.insertSnapshot(s);
    const state = mem();
    const ctx: AgentContext = { ...stores, strategy: v01, paused: false, method: writerBreakeven };
    const now = istTs(DAY, '10:01', 6);
    expect((await agentCatchUp(ctx, state, U, now)).opened).toBe(2);
    expect(await agentCatchUp(ctx, state, U, now)).toEqual({ decisions: 0, opened: 0, closed: 0 });
    expect(await state.getState(`last_step_${U}`)).toBe(String(istTs(DAY, '10:01')));
  });
  it('if the agent was down for longer than 5 minutes, the old minutes are not replayed as if they were tradable: open trades are closed as a data gap and only fresh minutes are processed', async () => {
    const stores = freshStores();
    for (const s of pathDay([['10:00', 23880], ['10:01', 23862], ['10:02', 23890], ['10:15', 23890], ['10:16', 23890]], '09:15')) await stores.store.insertSnapshot(s);
    const state = mem();
    const ctx: AgentContext = { ...stores, strategy: v01, paused: false, method: writerBreakeven };
    await agentCatchUp(ctx, state, U, istTs(DAY, '10:01', 6)); // opens the trade, then the agent stops
    const result = await agentCatchUp(ctx, state, U, istTs(DAY, '10:16', 6));
    const outcomes = await stores.journal.outcomesForDay(DAY);
    expect(outcomes.map((o) => o.outcome.exitReason)).toEqual(['data_gap', 'data_gap']);
    expect(outcomes[0].outcome.closedTs).toBeLessThan(istTs(DAY, '10:15')); // closed at the last old minute, not at today's prices
    expect(result.closed).toBeGreaterThan(0);
    expect(await state.getState(`last_step_${U}`)).toBe(String(istTs(DAY, '10:16')));
  });
  it('with no snapshots yet it does nothing and remembers nothing', async () => {
    const stores = freshStores();
    const state = mem();
    expect(await agentCatchUp({ ...stores, strategy: v01, paused: false }, state, U, istTs(DAY, '10:00', 6))).toEqual({ decisions: 0, opened: 0, closed: 0 });
    expect(await state.getState(`last_step_${U}`)).toBeNull();
  });
});
