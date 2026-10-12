import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { evaluate, watchLevels, type Candidate } from '@/lib/ltp-agent/signals';
import { parseStrategy, type Strategy } from '@/lib/ltp-agent/strategy';
import { istTs } from '@/lib/ltp/time';
import { EXT, fakeAnalysis, fakeLines, type FakeOpts } from '../support/ltp-analysis';

const v01 = parseStrategy(readFileSync('strategies/ltp_v0.1.yaml', 'utf8'));
const idle = { dayTradeCount: 0, openCount: 0, dayLossInr: 0 };
const run = (opts: FakeOpts = {}, strategy: Strategy = v01, ctx = idle) => evaluate(fakeAnalysis(opts), strategy, ctx);
const only = (cs: Candidate[]) => { expect(cs).toHaveLength(1); return cs[0]; };
const ALL = ['scenario_allowed', 'time_window', 'level_touched', 'valid_plan', 'hit_number', 'coa2_agree', 'soc_opposes', 'daily_trade_cap', 'max_concurrent', 'daily_loss_cap'];
// Spots that put the price on EOS (24010) / EOR (24200) with the previous minute far away, which is what makes a touch.
const atEos = { spot: 24012, spots: [24092, 24012] };
const atEor = { spot: 24198, spots: [24120, 24198] };

describe('a touch of EOS in scenario 1 is taken, with the whole rule trace', () => {
  const c = only(run(atEos));
  it('long at EOS on hit 1, entry at the spot, stop EOS-2 less the buffer, target EOR', () => {
    expect(c).toMatchObject({ setup: 'coa1_reversal', direction: 'long', level: { label: 'EOS', value: EXT.eos }, hit: 1, taken: true, skipReason: null, entry: 24012, scenario: 1, anchorStrike: 24000 });
    expect(c.stop).toBe(EXT.eosMinus2 - 10); // 23900
    expect(c.target).toBe(EXT.eor);
    expect(c.plannedRiskPts).toBe(24012 - 23900);
    expect(c.rewardPts).toBe(24200 - 24012);
  });
  it('lists every rule in order, each passed', () => {
    expect(c.trace.map((s) => s.rule)).toEqual(ALL);
    expect(c.trace.every((s) => s.passed)).toBe(true);
  });
  it('keeps the inputs of each rule, so the why can be read back', () => {
    expect(c.trace.find((s) => s.rule === 'level_touched')).toEqual({ rule: 'level_touched', inputs: { spot: 24012, level: 24010, tolerance: 5, previous_spot: 24092 }, passed: true });
    expect(c.trace.find((s) => s.rule === 'hit_number')).toEqual({ rule: 'hit_number', inputs: { hit: 1, max: 2 }, passed: true });
    expect(c.trace.find((s) => s.rule === 'time_window')?.inputs).toEqual({ time: '10:42', start: '09:30', end: '14:45' });
  });
  it('is a touch only on the way in: staying inside the band the next minute is not a second candidate', () => {
    expect(run({ spot: 24011, spots: [24092, 24012, 24011] })).toEqual([]);
  });
  it('a spot nowhere near a level gives no candidate at all', () => {
    expect(run({ spot: 24100, spots: [24150, 24100] })).toEqual([]);
  });
});

describe('the nine COA 1.0 scenarios: which side is traded, at which level', () => {
  // [support status, resistance status, scenario, long level, long taken, short level, short taken]
  const table: ['strong' | 'wtt' | 'wtb', 'strong' | 'wtt' | 'wtb', number, string, boolean, string, boolean][] = [
    ['strong', 'strong', 1, 'EOS', true, 'EOR', true],
    ['strong', 'wtb', 2, 'EOS-1', true, 'EOR', true],
    ['strong', 'wtt', 3, 'EOS', true, 'WTT-1', true],
    ['wtb', 'strong', 4, 'WTB+1', true, 'EOR', true],
    ['wtt', 'strong', 5, 'EOS', true, 'EOR+1', true],
    ['wtb', 'wtb', 6, 'EOS', false, 'EOR', true], // Blood Bath: no longs
    ['wtt', 'wtt', 7, 'EOS', true, 'EOR', false], // Bull Run: no shorts
    ['wtb', 'wtt', 8, 'WTB+1', true, 'WTT-1', true], // tradable in the Detailed Chart of Accuracy
    ['wtt', 'wtb', 9, 'EOS-1', true, 'EOR+1', true],
  ];
  const valueOf: Record<string, number> = { EOS: EXT.eos, 'EOS-1': EXT.eosMinus1, 'WTB+1': EXT.wtbPlus1, EOR: EXT.eor, 'WTT-1': EXT.wttMinus1, 'EOR+1': EXT.eorPlus1 };
  for (const [support, resistance, n, longLevel, longTaken, shortLevel, shortTaken] of table) {
    it(`scenario ${n}: long at ${longLevel} ${longTaken ? 'taken' : 'skipped'}, short at ${shortLevel} ${shortTaken ? 'taken' : 'skipped'}`, () => {
      const l = only(run({ support, resistance, spot: valueOf[longLevel] + 2, spots: [valueOf[longLevel] + 90, valueOf[longLevel] + 2] }));
      expect(l).toMatchObject({ direction: 'long', scenario: n, level: { label: longLevel }, taken: longTaken });
      if (!longTaken) expect(l.skipReason).toBe('scenario_allowed');
      const s = only(run({ support, resistance, spot: valueOf[shortLevel] - 2, spots: [valueOf[shortLevel] - 90, valueOf[shortLevel] - 2] }));
      expect(s).toMatchObject({ direction: 'short', scenario: n, level: { label: shortLevel }, taken: shortTaken });
      if (!shortTaken) expect(s.skipReason).toBe('scenario_allowed');
    });
  }
  it('the moderate profile enters one strike further out: EOS-1 for longs, EOR+1 for shorts (only where the scenario names the primary level)', () => {
    const moderate = { ...v01, entry_profile: 'moderate' as const };
    expect(only(run({ spot: EXT.eosMinus1 + 2, spots: [24100, EXT.eosMinus1 + 2] }, moderate)).level).toMatchObject({ label: 'EOS-1', value: EXT.eosMinus1 });
    expect(only(run({ spot: EXT.eorPlus1 - 2, spots: [24100, EXT.eorPlus1 - 2] }, moderate)).level).toMatchObject({ label: 'EOR+1', value: EXT.eorPlus1 });
  });
});

describe('v2.0 decides from the mind-map outcome, not from the first-level scenario number, and the tug of war allows risky trades', () => {
  const v20t = parseStrategy(readFileSync('strategies/ltp_v2.0.yaml', 'utf8'));
  it('the first-level scenario table is not consulted: switch off both sides of scenario 1 in the table and v2.0 still trades the outcome, while a version that uses the table skips', () => {
    const a = fakeAnalysis({ spot: EXT.eos + 2, spots: [EXT.eos + 90, EXT.eos + 2] });
    const edited = (base: typeof v20t) => ({ ...base, scenarios_traded: { ...base.scenarios_traded, '1': { long: false, short: false } } });
    expect(evaluate(a, edited(v20t), idle).find((x) => x.direction === 'long')).toMatchObject({ taken: true });
    expect(evaluate(a, edited(v01), idle).find((x) => x.direction === 'long')).toMatchObject({ taken: false, skipReason: 'scenario_allowed' });
  });
  it('block_scenarios is not consulted either', () => {
    const a = fakeAnalysis({ spot: EXT.eos + 2, spots: [EXT.eos + 90, EXT.eos + 2] });
    expect(evaluate(a, { ...v20t, block_scenarios: [1] }, idle).find((x) => x.direction === 'long')).toMatchObject({ taken: true });
    expect(evaluate(a, { ...v01, block_scenarios: [1] }, idle).find((x) => x.direction === 'long')).toMatchObject({ taken: false });
  });
  it('where the outcome has no bottom there is no long signal at all in v2.0 (nothing to show or skip); v0.1 still raises it and skips it', () => {
    const a = fakeAnalysis({ pressure: { support: 'B', resistance: 'B' }, spot: EXT.eos + 2, spots: [EXT.eos + 90, EXT.eos + 2] });
    expect(a.coa1.scenario.bottom).toBeNull();
    expect(evaluate(a, v20t, idle).filter((x) => x.direction === 'long')).toEqual([]);
    expect(evaluate(a, v01, idle).find((x) => x.direction === 'long')).toMatchObject({ taken: false, skipReason: 'scenario_allowed' });
  });
  it('the same for the top: in a Bull Run there is no short signal in v2.0, whichever setup would have raised it', () => {
    const a = fakeAnalysis({ pressure: { support: 'U', resistance: 'U' }, spot: EXT.eor - 2, spots: [EXT.eor - 90, EXT.eor - 2] });
    expect(a.coa1.scenario.top).toBeNull();
    expect(evaluate(a, v20t, idle).filter((x) => x.direction === 'short')).toEqual([]);
  });
  it('the Watch list in v2.0 shows only the sides the outcome has a level for', () => {
    const a = fakeAnalysis({ pressure: { support: 'B', resistance: 'B' } });
    expect(watchLevels(a, v20t, idle).map((x) => x.direction)).not.toContain('long');
    expect(watchLevels(a, v20t, idle).map((x) => x.direction)).toContain('short');
  });
  it('both sides pushing down: a risky short at the live Risky level is a candidate and is taken (bears are winning)', () => {
    const a = fakeAnalysis({ pressure: { support: 'B', resistance: 'B' }, spot: EXT.eorMinus1 - 2, spots: [EXT.eorMinus1 - 60, EXT.eorMinus1 - 2] });
    const c = evaluate(a, v20t, idle).filter((x) => x.setup === 'risky_tug');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ direction: 'short', taken: true, level: { label: 'Risky', value: EXT.eorMinus1 } });
  });
  it('both sides pushing up: a risky long at the Risky level; one side highly pushing with the other stable: risky as well', () => {
    const up = fakeAnalysis({ pressure: { support: 'U', resistance: 'U' }, spot: EXT.eosPlus1 + 2, spots: [EXT.eosPlus1 + 60, EXT.eosPlus1 + 2] });
    expect(evaluate(up, v20t, idle).filter((x) => x.setup === 'risky_tug')).toMatchObject([{ direction: 'long', taken: true }]);
    const highStable = fakeAnalysis({ pressure: { support: 'S', resistance: 'HB' }, spot: EXT.eorMinus1 - 2, spots: [EXT.eorMinus1 - 60, EXT.eorMinus1 - 2] });
    expect(evaluate(highStable, v20t, idle).filter((x) => x.setup === 'risky_tug')).toMatchObject([{ direction: 'short', taken: true }]);
  });
  it('no risky trade for a mild lead (one side plainly pushing, the other stable), for sides pulling against each other, or in v0.1', () => {
    const mild = fakeAnalysis({ pressure: { support: 'B', resistance: 'S' }, spot: EXT.eorMinus1 - 2, spots: [EXT.eorMinus1 - 60, EXT.eorMinus1 - 2] });
    expect(evaluate(mild, v20t, idle).filter((x) => x.setup === 'risky_tug')).toEqual([]);
    const contested = fakeAnalysis({ pressure: { support: 'HB', resistance: 'U' }, spot: EXT.eorMinus1 - 2, spots: [EXT.eorMinus1 - 60, EXT.eorMinus1 - 2] });
    expect(evaluate(contested, v20t, idle).filter((x) => x.setup === 'risky_tug')).toEqual([]);
    const both = fakeAnalysis({ pressure: { support: 'B', resistance: 'B' }, spot: EXT.eorMinus1 - 2, spots: [EXT.eorMinus1 - 60, EXT.eorMinus1 - 2] });
    expect(evaluate(both, v01, idle).filter((x) => x.setup === 'risky_tug')).toEqual([]);
  });
});

describe('v2.0 keeps one diversion as the stop for every setup: one strike step (50 points in NIFTY)', () => {
  const v20s = parseStrategy(readFileSync('strategies/ltp_v2.0.yaml', 'utf8'));
  it('the strategy says so, and v0.1 keeps the 9:20 style stop', () => {
    expect(v20s.stop_rule).toBe('one_diversion');
    expect(v01.stop_rule).toBe('nine_twenty');
  });
  it('a long from EOS: stop one step below the entry, a short from EOR one step above, planned risk 50', () => {
    const long = evaluate(fakeAnalysis({ spot: 24012, spots: [24092, 24012] }), v20s, idle).find((x) => x.direction === 'long')!;
    expect(long).toMatchObject({ entry: 24012, stop: 23962, plannedRiskPts: 50, taken: true });
    const short = evaluate(fakeAnalysis({ spot: 24198, spots: [24120, 24198] }), v20s, idle).find((x) => x.direction === 'short')!;
    expect(short).toMatchObject({ entry: 24198, stop: 24248, plannedRiskPts: 50, taken: true });
  });
  it('the risky and the very risky entries use the same one-diversion stop', () => {
    const risky = evaluate(fakeAnalysis({ pressure: { support: 'B', resistance: 'B' }, spot: EXT.eorMinus1 - 2, spots: [EXT.eorMinus1 - 60, EXT.eorMinus1 - 2] }), v20s, idle).find((x) => x.setup === 'risky_tug')!;
    expect(risky).toMatchObject({ direction: 'short', stop: EXT.eorMinus1 - 2 + 50, plannedRiskPts: 50 });
    const eod = evaluate(fakeAnalysis({ pressure: { support: 'HB', resistance: 'B' }, spot: 24108, spots: [24040, 24108] }), v20s, idle).find((x) => x.setup === 'very_risky_eod')!;
    expect(eod).toMatchObject({ direction: 'short', stop: 24158, plannedRiskPts: 50 });
  });
  it('the SOC and 9:20 setups too', () => {
    const soc = { type: '1h' as const, side: 'support' as const, bias: 'bearish' as const, from: 'EOR' as const, startedAt: 0, minutes: 70, spread: 3, targetStrike: 23900, zone: { low: 23900, high: 24000 }, target: 24090 };
    const onlySoc = { ...v20s, setups_enabled: { ...v20s.setups_enabled, coa1_reversal: false, risky_tug: false, very_risky_eod: false } };
    expect(evaluate(fakeAnalysis({ spot: 24198, spots: [24120, 24198], soc }), onlySoc, idle).find((x) => x.setup === 'soc')).toMatchObject({ direction: 'short', stop: 24248, plannedRiskPts: 50 });
    const nine = { ...v20s, setups_enabled: { ...v20s.setups_enabled, coa1_reversal: false, risky_tug: false, very_risky_eod: false, soc: false } };
    const c = evaluate(fakeAnalysis({ spot: 24148, spots: [24060, 24148], lines: fakeLines(), hhmm: '09:30' }), nine, idle).find((x) => x.setup === 'nine_twenty')!;
    expect(c).toMatchObject({ stop: c.entry + (c.direction === 'short' ? 50 : -50), plannedRiskPts: 50 });
  });
  it('the step is the index\'s own: 100 points in BANKNIFTY, and the Watch list uses it from the level', () => {
    const a = fakeAnalysis({ underlying: 'NSE:NIFTYBANK-INDEX', step: 100, spot: 24012, spots: [24092, 24012] });
    expect(evaluate(a, v20s, idle).find((x) => x.direction === 'long')).toMatchObject({ stop: 23912, plannedRiskPts: 100 });
    expect(watchLevels(fakeAnalysis(), v20s, idle).find((x) => x.direction === 'long')).toMatchObject({ entry: EXT.eos, stop: EXT.eos - 50 });
  });
});

describe('very high push: a very risky trade at the nearest end of diversion', () => {
  const v20e = parseStrategy(readFileSync('strategies/ltp_v2.0.yaml', 'utf8'));
  const veryRisky = (opts: FakeOpts, strategy: Strategy = v20e) => evaluate(fakeAnalysis(opts), strategy, idle).filter((x) => x.setup === 'very_risky_eod');
  it('highly bearish with bearish: a very risky short when the spot touches an end of diversion above it (24,110)', () => {
    const c = veryRisky({ pressure: { support: 'HB', resistance: 'B' }, spot: 24108, spots: [24040, 24108] });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ direction: 'short', taken: true, level: { label: 'EOD', value: 24110 } });
  });
  it('both highly bearish counts too; the mirror for bulls is a very risky long at the nearest end of diversion below (24,090)', () => {
    expect(veryRisky({ pressure: { support: 'HB', resistance: 'HB' }, spot: 24158, spots: [24040, 24158] })).toMatchObject([{ direction: 'short', taken: true, level: { value: 24160 } }]);
    expect(veryRisky({ pressure: { support: 'U', resistance: 'HU' }, spot: 24092, spots: [24170, 24092] })).toMatchObject([{ direction: 'long', taken: true, level: { label: 'EOD', value: 24090 } }]);
  });
  it('high but not very high (both plain, or one highly with the other stable), contested, mild and v0.1: no very risky trade', () => {
    for (const pressure of [{ support: 'B', resistance: 'B' }, { support: 'HB', resistance: 'S' }, { support: 'HB', resistance: 'U' }, { support: 'B', resistance: 'S' }] as const) expect(veryRisky({ pressure, spot: 24108, spots: [24040, 24108] })).toEqual([]);
    expect(veryRisky({ pressure: { support: 'HB', resistance: 'B' }, spot: 24108, spots: [24040, 24108] }, v01)).toEqual([]);
  });
  it('a spot away from every end of diversion raises nothing; the Watch list shows the nearest end of diversion on the entry side', () => {
    expect(veryRisky({ pressure: { support: 'HB', resistance: 'B' }, spot: 24130, spots: [24040, 24130] })).toEqual([]);
    const watch = watchLevels(fakeAnalysis({ pressure: { support: 'HB', resistance: 'B' }, spot: 24130, spots: [24040, 24130] }), v20e, idle).filter((x) => x.setup === 'very_risky_eod');
    expect(watch).toMatchObject([{ direction: 'short', level: { label: 'EOD', value: 24160 } }]); // 24,110 is below the spot, 24,160 is the nearest above
  });
  it('it does not double up with the ordinary risky trade when both would enter in the same minute', () => {
    const a = fakeAnalysis({ pressure: { support: 'HB', resistance: 'B' }, spot: EXT.eorMinus1 - 2, spots: [EXT.eorMinus1 - 60, EXT.eorMinus1 - 2] });
    expect(evaluate(a, v20e, idle).filter((x) => x.direction === 'short' && (x.setup === 'risky_tug' || x.setup === 'very_risky_eod')).length).toBeLessThanOrEqual(1);
  });
});

describe('the knowledge-graph guard of v2.0', () => {
  const v20 = parseStrategy(readFileSync('strategies/ltp_v2.0.yaml', 'utf8'));
  const inconsistent = () => { const a = fakeAnalysis({ spot: EXT.eos + 2, spots: [EXT.eos + 90, EXT.eos + 2] }); a.coa1.scenario = { ...a.coa1.scenario, top: 'EOR+1' }; return a; }; // the graph says EOR, the live scenario says EOR+1
  it('v2.0 skips a signal when the live scenario and the graph disagree, and says so in the scenario rule', () => {
    const c = evaluate(inconsistent(), v20, idle).find((x) => x.direction === 'long')!;
    expect(c).toMatchObject({ taken: false, skipReason: 'scenario_allowed' });
    expect(c.trace.find((s) => s.rule === 'scenario_allowed')!.inputs).toMatchObject({ graph_consistent: false });
  });
  it('v0.1 does not use the guard and takes the same signal', () => {
    expect(evaluate(inconsistent(), v01, idle).find((x) => x.direction === 'long')).toMatchObject({ taken: true });
  });
  it('when they agree v2.0 trades as before', () => {
    const a = fakeAnalysis({ spot: EXT.eos + 2, spots: [EXT.eos + 90, EXT.eos + 2] });
    expect(evaluate(a, v20, idle).find((x) => x.direction === 'long')).toMatchObject({ taken: true });
  });
});

describe('a side the Detailed Chart gives no level for is never traded', () => {
  it('no bottom: the long is skipped as scenario_allowed even though the strategy table allows longs in this scenario', () => {
    const a = fakeAnalysis({ spot: EXT.eos + 2, spots: [EXT.eos + 90, EXT.eos + 2] });
    a.coa1.scenario = { ...a.coa1.scenario, bottom: null };
    const c = evaluate(a, v01, idle).find((x) => x.direction === 'long')!;
    expect(c).toMatchObject({ taken: false, skipReason: 'scenario_allowed' });
  });
});

describe('every rule is the first failure somewhere, and the trace stops there', () => {
  const failing = (c: Candidate, rule: string) => {
    expect(c.taken).toBe(false);
    expect(c.skipReason).toBe(rule);
    expect(c.trace[c.trace.length - 1]).toMatchObject({ rule, passed: false });
    expect(c.trace.slice(0, -1).every((s) => s.passed)).toBe(true);
    expect(c.trace.map((s) => s.rule)).toEqual(ALL.slice(0, ALL.indexOf(rule) + 1));
  };
  it('a setup that is switched off produces no candidate at all', () => {
    expect(run(atEos, { ...v01, setups_enabled: { ...v01.setups_enabled, coa1_reversal: false } })).toEqual([]);
  });
  it('time_window: before 09:30 and after 14:45', () => {
    failing(only(run({ ...atEos, hhmm: '09:25' })), 'time_window');
    failing(only(run({ ...atEos, hhmm: '14:50' })), 'time_window');
  });
  it('valid_plan: no stop level, or a target on the wrong side of the entry', () => {
    failing(only(run({ ...atEos, missing: ['eosMinus2'] })), 'valid_plan');
    failing(only(run({ ...atEos, missing: ['eor'] })), 'valid_plan');
  });
  it('hit_number: the third approach is skipped, the second is taken', () => {
    const approaches = (n: number) => Array.from({ length: n }, () => [24100, 24012]).flat();
    failing(only(run({ spot: 24012, spots: approaches(3) })), 'hit_number');
    expect(only(run({ spot: 24012, spots: approaches(2) }))).toMatchObject({ taken: true, hit: 2 });
  });
  it('hit_number: a level that moved is a new level, so only the touches since its side last moved count', () => {
    const approaches = (n: number) => Array.from({ length: n }, () => [24100, 24012]).flat();
    // EOS belongs to the support side: it moved at minute 4, after two approaches, so the third approach is the first touch of the new level.
    expect(only(run({ spot: 24012, spots: approaches(3), shiftedAt: { support: 4 } }))).toMatchObject({ taken: true, hit: 1 });
    expect(only(run({ spot: 24012, spots: approaches(3), shiftedAt: { support: 2 } }))).toMatchObject({ taken: true, hit: 2 }); // moved after one approach
    failing(only(run({ spot: 24012, spots: approaches(4), shiftedAt: { support: 2 } })), 'hit_number');
    // the other side moving does not reset it
    failing(only(run({ spot: 24012, spots: approaches(3), shiftedAt: { resistance: 4 } })), 'hit_number');
    // a short (EOR, resistance side) resets with the resistance side
    expect(only(run({ ...atEor, spots: [24120, 24198, 24120, 24198, 24120, 24198], shiftedAt: { resistance: 4 } }))).toMatchObject({ taken: true, hit: 1 });
  });
  it('coa2_agree: only enforced when the strategy asks for it; always logged', () => {
    const disagree = { coa2: { result: { status: 'ok' as const, number: 3, outcome: 'Reversal at resistance; support will break' } } };
    const noted = only(run({ ...atEos, ...disagree }));
    expect(noted.taken).toBe(true);
    expect(noted.trace.find((s) => s.rule === 'coa2_agree')?.inputs).toMatchObject({ agrees: false, required: false });
    failing(only(run({ ...atEos, ...disagree }, { ...v01, require_coa2_agree: true })), 'coa2_agree');
    failing(only(run({ ...atEos, coa2: { result: { status: 'outside_window' as const } } }, { ...v01, require_coa2_agree: true })), 'coa2_agree');
  });
  it('soc_opposes: a bearish SOC blocks a long; with the filter off it does not', () => {
    const soc = { type: '1h' as const, side: 'support' as const, bias: 'bearish' as const, from: 'EOR' as const, startedAt: 0, minutes: 70, spread: 3, targetStrike: 23900, zone: { low: 23900, high: 24000 }, target: 24090 };
    failing(only(run({ ...atEos, soc })), 'soc_opposes');
    expect(only(run({ ...atEos, soc }, { ...v01, block_on_opposing_soc: false })).taken).toBe(true);
  });
  it('daily_trade_cap, max_concurrent and daily_loss_cap', () => {
    failing(only(run(atEos, v01, { ...idle, dayTradeCount: 3 })), 'daily_trade_cap');
    failing(only(run(atEos, v01, { ...idle, openCount: 1 })), 'max_concurrent');
    failing(only(run(atEos, v01, { ...idle, dayLossInr: 15000 })), 'daily_loss_cap');
  });
  it('the first failing rule wins when several fail', () => {
    failing(only(run({ ...atEos, hhmm: '09:25' }, v01, { ...idle, dayTradeCount: 3 })), 'time_window');
  });
});

describe('the 9:20 setup', () => {
  const lines = fakeLines();
  it('trades the frozen lines from 09:21: the risky profile enters at Risky, stop at Max Pain less the buffer, target Max Gain', () => {
    const c = only(run({ hhmm: '09:25', spot: 24062, spots: [24120, 24062], lines }));
    expect(c).toMatchObject({ setup: 'nine_twenty', direction: 'long', level: { label: '9:20 Risky', value: 24060 }, taken: true, stop: 23900, target: 24200 });
  });
  it('the moderate profile enters at Moderate (EOS 24010 for longs)', () => {
    const moderate = { ...v01, entry_profile: 'moderate' as const, setups_enabled: { ...v01.setups_enabled, coa1_reversal: false } };
    expect(only(run({ hhmm: '10:00', spot: 24012, spots: [24090, 24012], lines }, moderate)).level).toMatchObject({ label: '9:20 Moderate', value: 24010 });
  });
  it('before 09:21 it is skipped on the time window, and with no frozen lines there is nothing to trade', () => {
    expect(only(run({ hhmm: '09:20', spot: 24062, spots: [24120, 24062], lines })).skipReason).toBe('time_window');
    expect(run({ hhmm: '10:00', spot: 24062, spots: [24120, 24062], lines: null })).toEqual([]);
  });
});

describe('the SOC setup', () => {
  const soc = (bias: 'bearish' | 'bullish') => ({ type: '1h' as const, side: bias === 'bearish' ? ('support' as const) : ('resistance' as const), bias, from: bias === 'bearish' ? ('EOR' as const) : ('EOS' as const), startedAt: 0, minutes: 70, spread: 3, targetStrike: 23900, zone: { low: 23900, high: 24000 }, target: bias === 'bearish' ? 24090 : 24120 });
  const socOnly = { ...v01, setups_enabled: { ...v01.setups_enabled, coa1_reversal: false } };
  it('the SOC trade targets the diversion of the zone (soc.target), not the opposite extension', () => {
    const bearish = only(run({ ...atEor, soc: { ...soc('bearish'), target: 24090 } }, socOnly));
    expect(bearish).toMatchObject({ setup: 'soc', direction: 'short', target: 24090, taken: true });
    const bullish = only(run({ ...atEos, soc: { ...soc('bullish'), target: 24120 } }, socOnly));
    expect(bullish).toMatchObject({ setup: 'soc', direction: 'long', target: 24120, taken: true });
  });
  it('a SOC without a diversion price has no plan and is skipped as valid_plan', () => {
    expect(only(run({ ...atEor, soc: { ...soc('bearish'), target: null } }, socOnly)).skipReason).toBe('valid_plan');
  });
  it('a bearish SOC trades a short at EOR, a bullish one a long at EOS (taken)', () => {
    expect(only(run({ ...atEor, soc: soc('bearish') }, socOnly))).toMatchObject({ setup: 'soc', direction: 'short', level: { label: 'EOR' }, taken: true });
    expect(only(run({ ...atEos, soc: soc('bullish') }, socOnly))).toMatchObject({ setup: 'soc', direction: 'long', level: { label: 'EOS' }, taken: true });
  });
  it('outside the time window the SOC trade is skipped', () => {
    expect(only(run({ ...atEor, hhmm: '09:25', soc: soc('bearish') }, socOnly)).skipReason).toBe('time_window');
  });
  it('when the COA 1.0 setup already has a candidate for that touch, the SOC setup adds none', () => {
    expect(run({ ...atEor, soc: soc('bearish') })).toHaveLength(1);
    expect(run({ ...atEor, soc: soc('bearish') })[0].setup).toBe('coa1_reversal');
  });
  it('with no SOC there is no SOC candidate', () => {
    expect(run(atEor, socOnly)).toEqual([]);
  });
});

describe('the clock comes from the analysis, not from the machine', () => {
  it('asOf 10:42 on 2026-10-12 is what the window check sees', () => {
    expect(fakeAnalysis().asOf).toBe(istTs('2026-10-12', '10:42'));
  });
});

describe('watchLevels: where the agent would trade from the current state, touched or not', () => {
  const watch = (opts: FakeOpts = {}, strategy: Strategy = v01, ctx = idle) => watchLevels(fakeAnalysis(opts), strategy, ctx);
  it('lists the long and the short level of the scenario even though the spot is nowhere near either', () => {
    const w = watch({ spot: 24100, spots: [24150, 24100] });
    expect(w.map((x) => [x.direction, x.level.label, x.level.value])).toEqual([['long', 'EOS', 24010], ['short', 'EOR', 24200]]);
  });
  it('the plan is built from the level, not the spot: entry at the level, stop and target around it, with risk and reward in points', () => {
    const long = watch({ spot: 24100, spots: [24150, 24100] }).find((x) => x.direction === 'long')!;
    expect(long).toMatchObject({ entry: 24010, stop: 23900, target: 24200, plannedRiskPts: 110, rewardPts: 190 });
  });
  it('says whether it would trade there now, and if not which rule stops it', () => {
    const open = watch({ spot: 24100, spots: [24150, 24100] });
    expect(open.every((x) => x.taken)).toBe(true);
    const bloodBath = watch({ support: 'wtb', resistance: 'wtb', spot: 24100, spots: [24150, 24100] });
    expect(bloodBath.find((x) => x.direction === 'long')).toMatchObject({ taken: false, skipReason: 'scenario_allowed' });
    expect(bloodBath.find((x) => x.direction === 'short')).toMatchObject({ taken: true });
    expect(watch({ hhmm: '09:20', spot: 24100, spots: [24150, 24100] }).every((x) => x.skipReason === 'time_window')).toBe(true);
    expect(watch({ spot: 24100, spots: [24150, 24100] }, v01, { ...idle, openCount: 1 }).every((x) => x.skipReason === 'max_concurrent')).toBe(true);
  });
  it('the hit number is the one the next touch would be: approaches so far plus one, unless the spot is already in the band', () => {
    const approaches = [24100, 24012, 24100, 24012, 24100];
    expect(watch({ spot: 24100, spots: approaches }).find((x) => x.direction === 'long')?.hit).toBe(3);
    expect(watch({ spot: 24100, spots: approaches }).find((x) => x.direction === 'long')?.skipReason).toBe('hit_number');
    expect(watch({ spot: 24012, spots: [24100, 24012] }).find((x) => x.direction === 'long')?.hit).toBe(1);
  });
  it('includes the 9:20 lines and the SOC level when those setups apply', () => {
    const w = watch({ hhmm: '10:00', spot: 24100, spots: [24150, 24100], lines: fakeLines() });
    expect(w.filter((x) => x.setup === 'nine_twenty').map((x) => [x.direction, x.level.label, x.level.value])).toEqual([['long', '9:20 Risky', 24060], ['short', '9:20 Risky', 24150]]);
  });
  it('a level that cannot be worked out (missing LTP) is left out rather than shown with a made-up value', () => {
    expect(watch({ spot: 24100, spots: [24150, 24100], missing: ['eos'] }).map((x) => x.direction)).toEqual(['short']);
  });
});
