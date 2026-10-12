import { describe, expect, it } from 'vitest';

import { writerBreakeven } from '@/lib/ltp/extensions';
import { freezeLines0920 } from '@/lib/ltp/lines0920';
import { istTs } from '@/lib/ltp/time';
import { makeChain } from '../support/ltp-chain';

const DAY = '2026-10-12';
// Support 23900 (strong), resistance 24200 (strong). PE LTPs at 23900/23850/23800: 40/30/25. CE LTPs at 24200/24250/24300: 55/45/35.
type Cells = Record<number, { ltp?: number | null; volume?: number; oi?: number }>;
// Merges overrides into the base cells field by field, so an LTP override keeps a strike's volume and OI lead.
const merge = (base: Cells, extra: Cells = {}): Cells => {
  const out: Cells = { ...base };
  for (const [k, v] of Object.entries(extra)) out[Number(k)] = { ...out[Number(k)], ...v };
  return out;
};
const chain = (hhmm: string, seconds = 0, extra: { ce?: Cells; pe?: Cells } = {}) =>
  makeChain({
    spot: 24037, step: 50, ts: istTs(DAY, hhmm, seconds),
    pe: merge({ 23900: { volume: 9000, oi: 9000, ltp: 40 }, 23850: { ltp: 30 }, 23800: { ltp: 25 } }, extra.pe),
    ce: merge({ 24200: { volume: 9000, oi: 9000, ltp: 55 }, 24250: { ltp: 45 }, 24300: { ltp: 35 } }, extra.ce),
  });

describe('freezeLines0920 (C9)', () => {
  const day = [chain('09:15'), chain('09:19', 59), chain('09:20'), chain('09:21')];

  it('freezes at the first snapshot at or after 09:20:00', () => {
    const lines = freezeLines0920(day, writerBreakeven)!;
    expect(lines.snapshotTs).toBe(istTs(DAY, '09:20'));
    expect(lines.delaySeconds).toBe(0);
    expect(lines.date).toBe(DAY);
  });

  it('computes EOR, EOR+1, EOR+2, EOS, EOS-1, EOS-2 from that snapshot', () => {
    const l = freezeLines0920(day, writerBreakeven)!;
    expect(l.eor.value).toBe(24200 + 55);
    expect(l.eorPlus1.value).toBe(24250 + 45);
    expect(l.eorPlus2.value).toBe(24300 + 35);
    expect(l.eos.value).toBe(23900 - 40);
    expect(l.eosMinus1.value).toBe(23850 - 30);
    expect(l.eosMinus2.value).toBe(23800 - 25);
    expect(l.eor.isProxy).toBe(true);
    expect(l.eor.method).toBe('writer_breakeven');
  });

  it('does not change when later snapshots differ', () => {
    const changed = [...day, chain('09:45', 0, { ce: { 24200: { ltp: 999 } }, pe: { 23900: { ltp: 1 } } })];
    expect(freezeLines0920(changed, writerBreakeven)).toEqual(freezeLines0920(day, writerBreakeven));
  });

  it('risky entries are EOR (short) and EOS (long); moderate are EOR+1 and EOS-1; stops are EOR+2 + 10 and EOS-2 - 10; risk is in points', () => {
    const l = freezeLines0920(day, writerBreakeven)!;
    expect(l.bearishAllowed).toBe(true);
    expect(l.bullishAllowed).toBe(true);
    // Short stop: EOR+2 (24335) + 10 = 24345. Long stop: EOS-2 (23775) - 10 = 23765.
    expect(l.profiles.risky).toContainEqual({ side: 'short', label: 'EOR', entry: 24255, stop: 24345, target: 24200 - 100, riskPoints: 90 });
    expect(l.profiles.moderate).toContainEqual({ side: 'short', label: 'EOR+1', entry: 24295, stop: 24345, target: 24250 - 100, riskPoints: 50 });
    expect(l.profiles.risky).toContainEqual({ side: 'long', label: 'EOS', entry: 23860, stop: 23765, target: 23900 + 100, riskPoints: 95 });
    expect(l.profiles.moderate).toContainEqual({ side: 'long', label: 'EOS-1', entry: 23820, stop: 23765, target: 23850 + 100, riskPoints: 55 });
    expect(l.profiles.risky).toHaveLength(2);
    expect(l.profiles.moderate).toHaveLength(2);
  });

  it('a missing EOR+1 blocks bearish trades for the day, and bullish ones stay', () => {
    const missing = [chain('09:20', 0, { ce: { 24250: { ltp: null } } })];
    const l = freezeLines0920(missing, writerBreakeven)!;
    expect(l.bearishAllowed).toBe(false);
    expect(l.bullishAllowed).toBe(true);
    expect(l.profiles.risky.every((e) => e.side === 'long')).toBe(true);
    expect(l.profiles.moderate.every((e) => e.side === 'long')).toBe(true);
  });

  it('a missing EOS-1 blocks bullish trades, and a missing EOR blocks bearish ones', () => {
    const noEosMinus1 = freezeLines0920([chain('09:20', 0, { pe: { 23850: { ltp: null } } })], writerBreakeven)!;
    expect(noEosMinus1.bullishAllowed).toBe(false);
    expect(noEosMinus1.bearishAllowed).toBe(true);
    const noEor = freezeLines0920([chain('09:20', 0, { ce: { 24200: { ltp: null } } })], writerBreakeven)!;
    expect(noEor.bearishAllowed).toBe(false);
  });

  it('shows entries with no stop (and no risk figure) when EOR+2 or EOS-2 is missing, rather than inventing one', () => {
    const l = freezeLines0920([chain('09:20', 0, { ce: { 24300: { ltp: null } } })], writerBreakeven)!;
    const short = l.profiles.risky.find((e) => e.side === 'short')!;
    expect(short.stop).toBeNull();
    expect(short.riskPoints).toBeNull();
  });

  it('uses a late first snapshot and records the delay, and returns null before 09:20 or with no usable chain', () => {
    const late = freezeLines0920([chain('09:15'), chain('09:34', 30)], writerBreakeven)!;
    expect(late.delaySeconds).toBe(14 * 60 + 30);
    expect(freezeLines0920([chain('09:15'), chain('09:19', 59)], writerBreakeven)).toBeNull();
    expect(freezeLines0920([], writerBreakeven)).toBeNull();
    expect(freezeLines0920([makeChain({ spot: 100, step: 50, strikes: [24000, 24050], ts: istTs(DAY, '09:20') })], writerBreakeven)).toBeNull();
  });
});
