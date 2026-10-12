// The tug of war between the two sides. Each side pushes the market down (bearish), up (bullish) or not at all (stable), plainly or highly (H).
// Who is winning, and when a RISKY trade is allowed (owner rule, 2026-10-13): when both sides push the same way, or one pushes highly and the other
// is stable. Sides pulling against each other are contested: nobody wins, no risky trade. Pure.
import type { Pressure } from './pressure';

export type Tug = { winner: 'bears' | 'bulls' | 'contested' | 'none'; strength: 'high' | 'mild' | null; riskyAllowed: boolean; riskyDirection: 'short' | 'long' | null };

const push = (p: Pressure): -1 | 0 | 1 => (p === 'B' || p === 'HB' ? -1 : p === 'U' || p === 'HU' ? 1 : 0);
const high = (p: Pressure) => p === 'HB' || p === 'HU';

export function tugOfWar(support: Pressure, resistance: Pressure): Tug {
  const s = push(support);
  const r = push(resistance);
  if (s !== 0 && r !== 0 && s !== r) return { winner: 'contested', strength: null, riskyAllowed: false, riskyDirection: null };
  if (s === 0 && r === 0) return { winner: 'none', strength: null, riskyAllowed: false, riskyDirection: null };
  const dir = (s || r) as -1 | 1;
  const sameWay = s === r; // both push
  const oneHighOtherStable = (high(support) && r === 0) || (high(resistance) && s === 0);
  const riskyAllowed = sameWay || oneHighOtherStable;
  return { winner: dir === -1 ? 'bears' : 'bulls', strength: high(support) || high(resistance) || sameWay ? 'high' : 'mild', riskyAllowed, riskyDirection: riskyAllowed ? (dir === -1 ? 'short' : 'long') : null };
}

// "S-Bearish", "R-Bullish(H)", "R-Stable": the short tag of one side.
export function sideTag(side: 'S' | 'R', p: Pressure): string {
  const word = push(p) === -1 ? 'Bearish' : push(p) === 1 ? 'Bullish' : 'Stable';
  return `${side}-${word}${high(p) ? '(H)' : ''}`;
}

// The short form of a signal everywhere in the agent: "6(S1/R1) S-Bearish R-Bullish(H)".
export const signalTag = (a: { coa1: { label: string; pressure: { support: Pressure; resistance: Pressure } } }): string => `${a.coa1.label} ${sideTag('S', a.coa1.pressure.support)} ${sideTag('R', a.coa1.pressure.resistance)}`;
