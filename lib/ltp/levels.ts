// C1 the imaginary line and C2 support / resistance, separately for volume and for OI. Pure.
import { strikesOf, valueAt, type LevelSide, type Metric, type Side, type Snapshot } from './types';

export type Line = { low: number; high: number; exact: boolean };
export type MetricPick = { strike: number; value: number; secondStrike: number | null; secondValue: number | null };
export type SideLevel = { strike: number; decidedBy: Metric | 'volume+oi'; byVolume: MetricPick | null; byOi: MetricPick | null };
export type Levels = { line: Line; support: SideLevel; resistance: SideLevel };

// The two adjacent strikes that bracket the spot (low <= spot < high). A spot exactly on a strike is that strike, and it then belongs to
// both searches. No line when the spot is outside the strikes or fewer than two strikes exist.
export function imaginaryLine(spot: number, strikes: number[]): Line | null {
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  if (sorted.length < 2 || spot < sorted[0] || spot > sorted[sorted.length - 1]) return null;
  const exact = sorted.find((k) => k === spot);
  if (exact !== undefined) return { low: exact, high: exact, exact: true };
  const low = [...sorted].reverse().find((k) => k < spot)!;
  const high = sorted.find((k) => k > spot)!;
  return { low, high, exact: false };
}

// The highest and second-highest value of `metric` over the given strikes on one side. Strikes with no value are skipped, never read as
// zero. A tie goes to the strike closer to the line (`nearer` ranks strikes, smaller is closer).
function pick(s: Snapshot, strikes: number[], side: Side, metric: Metric, distance: (strike: number) => number): MetricPick | null {
  const ranked = strikes
    .map((strike) => ({ strike, value: valueAt(s, strike, side, metric) }))
    .filter((c): c is { strike: number; value: number } => c.value !== null)
    .sort((a, b) => b.value - a.value || distance(a.strike) - distance(b.strike));
  if (!ranked.length) return null;
  const [top, second] = ranked;
  return { strike: top.strike, value: top.value, secondStrike: second?.strike ?? null, secondValue: second?.value ?? null };
}

function decide(volume: MetricPick | null, oi: MetricPick | null, distance: (strike: number) => number): SideLevel | null {
  if (!volume && !oi) return null;
  if (volume && oi) {
    if (volume.strike === oi.strike) return { strike: volume.strike, decidedBy: 'volume+oi', byVolume: volume, byOi: oi };
    const volumeWins = distance(volume.strike) < distance(oi.strike);
    return { strike: volumeWins ? volume.strike : oi.strike, decidedBy: volumeWins ? 'volume' : 'oi', byVolume: volume, byOi: oi };
  }
  return { strike: (volume ?? oi)!.strike, decidedBy: volume ? 'volume' : 'oi', byVolume: volume, byOi: oi };
}

export function computeLevels(s: Snapshot): Levels | null {
  const strikes = strikesOf(s);
  const line = imaginaryLine(s.spot, strikes);
  if (!line) return null;
  const supportStrikes = strikes.filter((k) => k <= line.low);
  const resistanceStrikes = strikes.filter((k) => k >= line.high);
  const downFromLine = (k: number) => line.low - k;
  const upFromLine = (k: number) => k - line.high;
  const support = decide(pick(s, supportStrikes, 'PE', 'volume', downFromLine), pick(s, supportStrikes, 'PE', 'oi', downFromLine), downFromLine);
  const resistance = decide(pick(s, resistanceStrikes, 'CE', 'volume', upFromLine), pick(s, resistanceStrikes, 'CE', 'oi', upFromLine), upFromLine);
  if (!support || !resistance) return null;
  return { line, support, resistance };
}

export const sideOf = (levels: Levels, side: LevelSide): SideLevel => (side === 'support' ? levels.support : levels.resistance);
