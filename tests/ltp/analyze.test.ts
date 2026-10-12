import { describe, expect, it } from 'vitest';

import { writerBreakeven } from '@/lib/ltp/extensions';
import { analyzeSession } from '@/lib/ltp/analyze';
import { timeValueOnly } from '@/lib/ltp/extensions';
import { istTs } from '@/lib/ltp/time';
import { makeChain } from '../support/ltp-chain';
import { syntheticDay } from '../support/ltp-day';

const DAY = '2026-10-12';
const day = syntheticDay(DAY);
const at = (hhmm: string, sec = 30) => istTs(DAY, hhmm, sec);

describe('COA 1.0 scenario follows the side directions, like the real tool', () => {
  const chain = (hhmm: string, pe23950: number) => makeChain({
    spot: 24037, step: 50, ts: istTs(DAY, hhmm),
    pe: { 23900: { volume: 10000, oi: 10000 }, 23950: { volume: pe23950, oi: pe23950 } },
    ce: { 24200: { volume: 10000, oi: 10000 }, 24150: { volume: 9000, oi: 9000 } },
  });
  it('support WTT back to Strong (bearish) with resistance WTB (bearish) is scenario 6, Blood Bath, even though the support is Strong now', () => {
    const r = analyzeSession([chain('09:15', 9000), chain('09:16', 100)], { now: istTs(DAY, '09:16', 30) });
    if (r.empty || !r.usable) throw new Error('expected a usable analysis');
    expect(r.strength.support.status).toBe('strong');
    expect(r.strength.resistance.status).toBe('wtb');
    expect(r.direction.support.current).toBe('bearish');
    expect(r.coa1.scenario.number).toBe(6);
    expect(r.direction.banner.kind).toBe('blood_bath');
  });
  it('support still weak towards top (bullish) with resistance WTB (bearish) is scenario 9, tradable in the detailed chart: top EOR+1, bottom EOS-1', () => {
    const r = analyzeSession([chain('09:15', 9000)], { now: istTs(DAY, '09:15', 30) });
    if (r.empty || !r.usable) throw new Error('expected a usable analysis');
    expect(r.coa1.scenario).toMatchObject({ number: 9, tradable: true, top: 'EOR+1', bottom: 'EOS-1' });
    expect(r.coa1.top?.label).toContain('EOR+1');
    expect(r.coa1.bottom?.label).toContain('EOS-1');
  });
  it('a side that is Strong now but bullish from its history gives EOR+1 as the top (support strong, resistance shifted up: S|U)', () => {
    const c = (hhmm: string, ce: Record<number, { volume: number; oi: number }>) => makeChain({ spot: 24037, step: 50, ts: istTs(DAY, hhmm), pe: { 23900: { volume: 10000, oi: 10000 } }, ce });
    const series = [c('09:15', { 24200: { volume: 10000, oi: 10000 }, 24250: { volume: 9000, oi: 9000 } }), c('09:16', { 24200: { volume: 10000, oi: 10000 }, 24250: { volume: 10500, oi: 10500 } })];
    const r = analyzeSession(series, { now: istTs(DAY, '09:16', 30) });
    if (r.empty || !r.usable) throw new Error('expected a usable analysis');
    expect(r.levels.resistance.strike).toBe(24250);
    expect(r.strength.resistance.status).toBe('strong');
    expect(r.direction.resistance.current).toBe('bullish');
    expect(r.coa1.scenario).toMatchObject({ number: 3, top: 'EOR+1', bottom: 'EOS' });
  });
});

describe('Risky entry', () => {
  const chain = (ce: Record<number, { volume: number; oi: number }>) => makeChain({ spot: 24037, step: 50, ts: istTs(DAY, '09:30'), pe: { 23900: { volume: 10000, oi: 10000 } }, ce });
  it('is one strike inside the level normally, and the reversal at the weak strike when resistance is WTB (real tool: Risky 22521.5 with resistance 22600 WTB-22500)', () => {
    const strong = analyzeSession([chain({ 24200: { volume: 10000, oi: 10000 } })], { now: istTs(DAY, '09:31') });
    const weak = analyzeSession([chain({ 24200: { volume: 10000, oi: 10000 }, 24100: { volume: 9000, oi: 9000 } })], { now: istTs(DAY, '09:31') });
    if (strong.empty || !strong.usable || weak.empty || !weak.usable) throw new Error('expected usable analyses');
    expect(strong.extensions.riskyShort.strike).toBe(24150); // EOR-1
    expect(weak.strength.resistance.status).toBe('wtb');
    expect(weak.extensions.riskyShort.strike).toBe(24100); // the weak strike, not EOR-1
  });
});

describe('analyzeSession (C1 to C10 together)', () => {
  it('has 376 synthetic snapshots from 09:15 to 15:30', () => {
    expect(day).toHaveLength(376);
    expect(day[0].ts).toBe(istTs(DAY, '09:15'));
    expect(day[375].ts).toBe(istTs(DAY, '15:30'));
  });

  it('is deterministic: two runs over the same day give identical output', () => {
    const a = analyzeSession(day, { now: at('15:30', 0) });
    const b = analyzeSession(day, { now: at('15:30', 0) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns an explicit empty result for no snapshots, and nothing from snapshots after `now`', () => {
    expect(analyzeSession([], { now: at('10:00') })).toEqual({ empty: true });
    expect(analyzeSession(day, { now: istTs(DAY, '09:00') })).toEqual({ empty: true });
  });

  it('sorts a list that arrives in the wrong order', () => {
    const reversed = [...day].reverse();
    expect(JSON.stringify(analyzeSession(reversed, { now: at('12:00') }))).toBe(JSON.stringify(analyzeSession(day, { now: at('12:00') })));
  });

  it('carries each side\'s event log, its current direction and the banner they make together', () => {
    const r = analyzeSession(day, { now: at('12:00', 0) });
    if (r.empty || !r.usable) throw new Error('expected a usable analysis');
    expect(r.direction.support.events[0].text).toMatch(/STRONG|WEAK/);
    expect(['bullish', 'bearish', 'neutral']).toContain(r.direction.support.current);
    expect(['blood_bath', 'bull_run', 'mixed']).toContain(r.direction.banner.kind);
    expect(r.direction.resistance.events.length).toBeGreaterThan(0);
  });

  it('each logged event carries the spot and the EOS/EOR family at that moment, as in the real tool\'s popup', () => {
    const r = analyzeSession(day, { now: at('09:30'), method: writerBreakeven });
    if (r.empty || !r.usable) throw new Error('expected a usable analysis');
    const first = r.direction.support.events[0];
    expect(first.spot).toBe(day[0].spot);
    // Support 23900: EOS 23900-40, EOS+1 at 23950 (PE LTP 100) and EOS-1 at 23850 (PE LTP 30).
    expect(first.reversals).toEqual({ center: 23860, plus1: 23850, minus1: 23820 });
    const res = r.direction.resistance.events[0];
    expect(res.reversals).toEqual({ center: 24255, plus1: 24295, minus1: 24250 }); // CE 24200:55, 24250:45, 24150:100
  });

  it('reads the levels, status, scenario and extensions of the latest snapshot', () => {
    const r = analyzeSession(day, { now: at('12:00', 0), method: writerBreakeven });
    if (r.empty || !r.usable) throw new Error('expected a usable analysis');
    expect(r.levels.support.strike).toBe(23900);
    expect(r.levels.resistance.strike).toBe(24200);
    expect(r.strength.support.strike).toBe(23900);
    expect(r.extensions.eos.value).toBe(23900 - 40);
    expect(r.extensions.eor.value).toBe(24200 + 55);
    expect(r.extensions.eor.isProxy).toBe(true);
    expect(r.coa1.scenario.number).toBeGreaterThanOrEqual(1);
    expect(r.diversions.count).toBe(6); // 23900 to 24200 in steps of 50
    expect(r.diversions.bullish.filter((d) => d.kind === 'diversion')).toHaveLength(6);
    expect(r.asOf).toBe(istTs(DAY, '12:00'));
  });

  it('COA 2.0 is outside its window before 09:45 and after 14:30, and has a result inside it', () => {
    const early = analyzeSession(day, { now: at('09:40', 0) });
    const mid = analyzeSession(day, { now: at('11:00', 0) });
    const late = analyzeSession(day, { now: at('14:35', 0) });
    if (early.empty || !early.usable || mid.empty || !mid.usable || late.empty || !late.usable) throw new Error('expected usable analyses');
    expect(early.coa2.result.status).toBe('outside_window');
    expect(late.coa2.result.status).toBe('outside_window');
    expect(['ok', 'no_data', 'not_on_first_hit']).toContain(mid.coa2.result.status);
  });

  it('the 9:20 lines exist only from 09:20, and later snapshots never change them', () => {
    const before = analyzeSession(day, { now: at('09:19', 30) });
    const after = analyzeSession(day, { now: at('09:21', 0) });
    const much = analyzeSession(day, { now: at('15:00', 0) });
    if (before.empty || !before.usable || after.empty || !after.usable || much.empty || !much.usable) throw new Error('expected usable analyses');
    expect(before.lines0920).toBeNull();
    expect(after.lines0920).not.toBeNull();
    expect(much.lines0920).toEqual(after.lines0920);
  });

  it('does not look ahead: changing snapshots after `now` changes nothing', () => {
    const now = at('11:00', 0);
    const tampered = day.map((s) => (s.ts > now ? makeChain({ spot: 25500, step: 50, ts: s.ts }) : s));
    expect(JSON.stringify(analyzeSession(tampered, { now }))).toBe(JSON.stringify(analyzeSession(day, { now })));
  });

  it('keeps the chart series: spot, weakness pct per side and metric, and the OI at each level since 09:15', () => {
    const r = analyzeSession(day, { now: at('12:00', 0) });
    if (r.empty || !r.usable) throw new Error('expected a usable analysis');
    expect(r.series.spot).toHaveLength(166); // 09:15 to 12:00 inclusive
    expect(r.series.pct).toHaveLength(166);
    expect(r.series.pct[0]).toHaveProperty('supportVolume');
    expect(r.series.ceOiAtResistance[0].ts).toBe(istTs(DAY, '09:15'));
    expect(r.series.peOiAtSupport).toHaveLength(166);
  });

  it('takes the extension method as a parameter', () => {
    const r = analyzeSession(day, { now: at('12:00', 0), method: timeValueOnly });
    if (r.empty || !r.usable) throw new Error('expected a usable analysis');
    expect(r.extensions.eos.method).toBe('time_value_only');
  });

  it('reports "no usable levels" instead of failing when the latest snapshot has no imaginary line', () => {
    const odd = makeChain({ spot: 10, step: 50, strikes: [24000, 24050], ts: istTs(DAY, '10:00') });
    const r = analyzeSession([odd], { now: istTs(DAY, '10:00', 30) });
    expect(r).toMatchObject({ empty: false, usable: false });
  });
});
