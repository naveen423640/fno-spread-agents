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
