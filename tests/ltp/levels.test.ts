import { describe, expect, it } from 'vitest';

import { computeLevels, imaginaryLine } from '@/lib/ltp/levels';
import { makeChain } from '../support/ltp-chain';

describe('imaginaryLine (C1)', () => {
  const strikes = [23900, 23950, 24000, 24050, 24100];
  it('brackets the spot between two adjacent strikes: spot 24037 gives 24000 / 24050', () => {
    expect(imaginaryLine(24037, strikes)).toEqual({ low: 24000, high: 24050, exact: false });
  });
  it('a spot exactly on a strike is that strike, and it belongs to both sides', () => {
    expect(imaginaryLine(24050, strikes)).toEqual({ low: 24050, high: 24050, exact: true });
  });
  it('has no line when the spot is outside the strikes, or the chain has too few strikes', () => {
    expect(imaginaryLine(23000, strikes)).toBeNull();
    expect(imaginaryLine(25000, strikes)).toBeNull();
    expect(imaginaryLine(24000, [24000])).toBeNull();
    expect(imaginaryLine(24000, [])).toBeNull();
  });
});

describe('computeLevels (C2)', () => {
  const spot = 24037; // line 24000 / 24050

  it('support is the highest PE value and resistance the highest CE value over ALL strikes, in-the-money ones included (real SENSEX 2026-10-12: support 72000 stayed with the spot at 71700)', () => {
    const s = makeChain({ spot, step: 50, pe: { 23900: { volume: 5000, oi: 5000 }, 24000: { volume: 3000, oi: 3000 }, 24100: { volume: 9000, oi: 9000 } }, ce: { 24150: { volume: 6000, oi: 6000 }, 24100: { volume: 2000, oi: 2000 }, 23950: { volume: 9999, oi: 9999 } } });
    const l = computeLevels(s)!;
    expect(l.line).toEqual({ low: 24000, high: 24050, exact: false });
    expect(l.support.byVolume!).toEqual({ strike: 24100, value: 9000, secondStrike: 23900, secondValue: 5000 }); // the PE at 24100 is in the money and still counts
    expect(l.resistance.byVolume!).toEqual({ strike: 23950, value: 9999, secondStrike: 24150, secondValue: 6000 }); // so does the CE at 23950
    expect(l.support.strike).toBe(24100);
    expect(l.support.decidedBy).toBe('volume+oi');
  });

  it('the level does not jump when the spot drifts across a strike: the same chain gives the same support at spot 71898 and 71924', () => {
    const chain = (spot: number) => makeChain({ spot, step: 100, pe: { 71500: { volume: 8_000_000, oi: 710_000 }, 72000: { volume: 14_000_000, oi: 828_000 } } });
    expect(computeLevels(chain(71898.67))!.support.strike).toBe(72000);
    expect(computeLevels(chain(71924.68))!.support.strike).toBe(72000);
  });

  it('both strikes of the pair belong to both searches (real NIFTY 10:30, spot 22464.65): support 22500 sits above the spot, resistance 22600', () => {
    const s = makeChain({ spot: 22464.65, step: 50, pe: { 22500: { volume: 4279053, oi: 331252 }, 22400: { volume: 2526135, oi: 265833 }, 22450: { volume: 2020976, oi: 180696 } }, ce: { 22600: { volume: 2859099, oi: 390490 }, 22700: { volume: 2077280, oi: 331263 }, 22450: { volume: 494973, oi: 46845 } } });
    const l = computeLevels(s)!;
    expect(l.line).toEqual({ low: 22450, high: 22500, exact: false });
    expect(l.support.strike).toBe(22500);
    expect(l.resistance.strike).toBe(22600);
    // The call at the lower strike of the pair is searched, the put at the upper strike too.
    const callBelow = computeLevels(makeChain({ spot: 22464.65, step: 50, ce: { 22450: { volume: 99999, oi: 99999 } } }))!;
    expect(callBelow.resistance.strike).toBe(22450);
  });

  it('equal highest values: the strike closer to the line wins, on both sides (distance counts both ways)', () => {
    const s = makeChain({ spot, step: 50, pe: { 23900: { volume: 5000 }, 24000: { volume: 5000 } }, ce: { 24100: { volume: 5000 }, 24200: { volume: 5000 } } });
    const l = computeLevels(s)!;
    expect(l.support.byVolume!.strike).toBe(24000);
    expect(l.resistance.byVolume!.strike).toBe(24100);
  });

  it('volume and OI disagree: the strike closer to the line is the level and decidedBy names the metric', () => {
    const s = makeChain({ spot, step: 50, pe: { 23800: { volume: 8000, oi: 1000 }, 24000: { volume: 1000, oi: 8000 } } });
    const l = computeLevels(s)!;
    expect(l.support.byVolume!.strike).toBe(23800);
    expect(l.support.byOi!.strike).toBe(24000);
    expect(l.support.strike).toBe(24000);
    expect(l.support.decidedBy).toBe('oi');
    const flipped = computeLevels(makeChain({ spot, step: 50, pe: { 23800: { volume: 1000, oi: 8000 }, 24000: { volume: 8000, oi: 1000 } } }))!;
    expect(flipped.support.strike).toBe(24000);
    expect(flipped.support.decidedBy).toBe('volume');
  });

  it('a spot exactly on a strike includes that strike on both sides', () => {
    const s = makeChain({ spot: 24050, step: 50, pe: { 24050: { volume: 9000, oi: 9000 } }, ce: { 24050: { volume: 9000, oi: 9000 } } });
    const l = computeLevels(s)!;
    expect(l.line.exact).toBe(true);
    expect(l.support.strike).toBe(24050);
    expect(l.resistance.strike).toBe(24050);
  });

  it('skips strikes with no value instead of treating them as zero (no OI on one side of the line)', () => {
    const nullOi = Object.fromEntries([23500, 23550, 23600, 23650, 23700, 23750, 23800, 23850, 23900, 23950, 24000, 24050, 24100, 24150, 24200, 24250, 24300, 24350, 24400, 24450, 24500, 24550].map((k) => [k, { oi: null }]));
    const s = makeChain({ spot, step: 50, pe: { ...nullOi, 23800: { oi: 10 } } });
    const l = computeLevels(s)!;
    expect(l.support.byOi!).toEqual({ strike: 23800, value: 10, secondStrike: null, secondValue: null });
  });

  it('uses the other metric when one metric has no data at all on a side', () => {
    const allNull = Object.fromEntries([23500, 23550, 23600, 23650, 23700, 23750, 23800, 23850, 23900, 23950, 24000, 24050, 24100, 24150, 24200, 24250, 24300, 24350, 24400, 24450, 24500, 24550].map((k) => [k, { oi: null }]));
    const s = makeChain({ spot, step: 50, pe: { ...allNull, 23900: { volume: 7000, oi: null } } });
    const l = computeLevels(s)!;
    expect(l.support.strike).toBe(23900);
    expect(l.support.decidedBy).toBe('volume');
  });

  it('returns null when there is no line or no strike on one side', () => {
    expect(computeLevels(makeChain({ spot: 20000, step: 50, strikes: [24000, 24050] }))).toBeNull();
    expect(computeLevels(makeChain({ spot: 24037, step: 50, strikes: [24050] }))).toBeNull();
  });
});
