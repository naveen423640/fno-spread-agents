import { describe, expect, it } from 'vitest';

import type { Pressure } from '@/lib/ltp/pressure';
import { signalTag, sideTag, tugOfWar } from '@/lib/ltp/tug-of-war';

const P: Pressure[] = ['S', 'B', 'U', 'HB', 'HU'];

describe('tugOfWar: who is winning, and when a risky trade is allowed', () => {
  it('both sides pushing the same way: that side wins and risky is allowed', () => {
    for (const [s, r] of [['B', 'B'], ['B', 'HB'], ['HB', 'B'], ['HB', 'HB']] as [Pressure, Pressure][]) expect(tugOfWar(s, r)).toMatchObject({ winner: 'bears', riskyAllowed: true, riskyDirection: 'short' });
    for (const [s, r] of [['U', 'U'], ['U', 'HU'], ['HU', 'U'], ['HU', 'HU']] as [Pressure, Pressure][]) expect(tugOfWar(s, r)).toMatchObject({ winner: 'bulls', riskyAllowed: true, riskyDirection: 'long' });
  });
  it('one side pushing highly and the other stable: risky is allowed', () => {
    for (const [s, r] of [['HB', 'S'], ['S', 'HB']] as [Pressure, Pressure][]) expect(tugOfWar(s, r)).toMatchObject({ winner: 'bears', riskyAllowed: true, riskyDirection: 'short' });
    for (const [s, r] of [['HU', 'S'], ['S', 'HU']] as [Pressure, Pressure][]) expect(tugOfWar(s, r)).toMatchObject({ winner: 'bulls', riskyAllowed: true, riskyDirection: 'long' });
  });
  it('one side pushing plainly and the other stable is a mild lead: no risky trade', () => {
    for (const [s, r] of [['B', 'S'], ['S', 'B']] as [Pressure, Pressure][]) expect(tugOfWar(s, r)).toMatchObject({ winner: 'bears', riskyAllowed: false, riskyDirection: null });
    for (const [s, r] of [['U', 'S'], ['S', 'U']] as [Pressure, Pressure][]) expect(tugOfWar(s, r)).toMatchObject({ winner: 'bulls', riskyAllowed: false });
  });
  it('the sides pulling against each other: nobody is winning, no risky trade, and a highly pushing side that is opposed does not count', () => {
    for (const [s, r] of [['B', 'U'], ['U', 'B'], ['HB', 'U'], ['U', 'HB'], ['HU', 'B'], ['B', 'HU'], ['HB', 'HU'], ['HU', 'HB']] as [Pressure, Pressure][]) expect(tugOfWar(s, r)).toMatchObject({ winner: 'contested', riskyAllowed: false, riskyDirection: null });
  });
  it('both stable: balanced, no risky trade', () => { expect(tugOfWar('S', 'S')).toMatchObject({ winner: 'none', riskyAllowed: false }); });
  it('covers every one of the 25 pairs exactly once, and risky is allowed in exactly 12 of them', () => {
    const all = P.flatMap((s) => P.map((r) => tugOfWar(s, r)));
    expect(all).toHaveLength(25);
    expect(all.filter((t) => t.riskyAllowed)).toHaveLength(12); // 4 + 4 both-same-way (bears, bulls) + 4 highly-and-stable
  });
  it('a side tag is short: S-Bearish, R-Bullish, with (H) when high, Stable when nothing pushes', () => {
    expect(sideTag('S', 'B')).toBe('S-Bearish');
    expect(sideTag('R', 'HU')).toBe('R-Bullish(H)');
    expect(sideTag('R', 'S')).toBe('R-Stable');
    expect(sideTag('S', 'HB')).toBe('S-Bearish(H)');
  });
  it('the signal tag is the scenario label with both side tags, like 6(S1/R1) S-Bearish R-Bullish(H)', () => {
    expect(signalTag({ coa1: { label: '6(S1/R1)', pressure: { support: 'B', resistance: 'HU' } } })).toBe('6(S1/R1) S-Bearish R-Bullish(H)');
    expect(signalTag({ coa1: { label: '1(S1/R1)', pressure: { support: 'S', resistance: 'S' } } })).toBe('1(S1/R1) S-Stable R-Stable');
  });
});
