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

  it('computes the whole EOR and EOS family from that snapshot', () => {
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

  it('lays the lines out like the real tool: short risky EOR-1, moderate EOR, Max Pain EOR+2, Max Gain EOS; long risky EOS+1, moderate EOS, Max Pain EOS-2, Max Gain EOR', () => {
    const l = freezeLines0920(day, writerBreakeven)!;
    // CE LTPs 24150:100 (default) 24200:55 24250:45 24300:35. PE LTPs 23950:100 (default) 23900:40 23850:30 23800:25.
    expect(l.short.risky.value).toBe(24150 + 100);
    expect(l.short.moderate.value).toBe(24200 + 55);
    expect(l.short.maxPain.value).toBe(24300 + 35);
    expect(l.short.maxGain.value).toBe(23900 - 40);
    expect(l.long.risky.value).toBe(23950 - 100);
    expect(l.long.moderate.value).toBe(23900 - 40);
    expect(l.long.maxPain.value).toBe(23800 - 25);
    expect(l.long.maxGain.value).toBe(24200 + 55);
    expect(l.short.available && l.long.available).toBe(true);
  });

  it('risk is the distance from each entry to Max Pain, in points', () => {
    const l = freezeLines0920(day, writerBreakeven)!;
    expect(l.short.riskPoints).toEqual({ risky: 24335 - 24250, moderate: 24335 - 24255 });
    expect(l.long.riskPoints).toEqual({ risky: 23850 - 23775, moderate: 23860 - 23775 });
  });

  it('a missing EOR+2 takes the short side out for the day, and the long side stays', () => {
    const l = freezeLines0920([chain('09:20', 0, { ce: { 24300: { ltp: null } } })], writerBreakeven)!;
    expect(l.short.available).toBe(false);
    expect(l.short.riskPoints.moderate).toBeNull();
    expect(l.long.available).toBe(true);
  });

  it('a missing EOS-2 takes the long side out, and a missing EOR takes out the short side', () => {
    expect(freezeLines0920([chain('09:20', 0, { pe: { 23800: { ltp: null } } })], writerBreakeven)!.long.available).toBe(false);
    expect(freezeLines0920([chain('09:20', 0, { ce: { 24200: { ltp: null } } })], writerBreakeven)!.short.available).toBe(false);
  });

  it('uses a late first snapshot and records the delay, and returns null before 09:20 or with no usable chain', () => {
    const late = freezeLines0920([chain('09:15'), chain('09:34', 30)], writerBreakeven)!;
    expect(late.delaySeconds).toBe(14 * 60 + 30);
    expect(freezeLines0920([chain('09:15'), chain('09:19', 59)], writerBreakeven)).toBeNull();
    expect(freezeLines0920([], writerBreakeven)).toBeNull();
    expect(freezeLines0920([makeChain({ spot: 100, step: 50, strikes: [24000, 24050], ts: istTs(DAY, '09:20') })], writerBreakeven)).toBeNull();
  });
});
