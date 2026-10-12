// C8 State of Confusion. Applies only when one side is weak and the opposite side is Strong. The clock starts when the weak side first
// became weak (the start of its current unbroken weak run). The "range" of pct is read as the spread max - min over the run.
import { LTP_CONFIG, type LtpConfig } from './config';
import type { LevelShift, SideStrength, StrengthPoint } from './strength';
import type { LevelSide } from './types';

export type SocResult = {
  type: '1h' | '2h' | '3h';
  side: LevelSide;
  bias: 'bearish' | 'bullish';
  from: 'EOR' | 'EOS'; // where the move starts: a support SOC falls from EOR, a resistance SOC rises from EOS
  startedAt: number; // unix seconds the current weak run began
  minutes: number; // length of the run so far
  spread: number | null; // max - min of the side's pct over the run, in points
  targetStrike: number; // the lowest (bearish) or highest (bullish) strike the level sat on during the run: where the diversion target is read
  zone: { low: number; high: number };
};

const decisivePct = (s: SideStrength) => {
  const v = [s.pct.volume, s.pct.oi].filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};

export function detectSoc(history: StrengthPoint[], events: LevelShift[], cfg: LtpConfig = LTP_CONFIG): SocResult | null {
  const pts = [...history].sort((a, b) => a.ts - b.ts);
  const latest = pts[pts.length - 1];
  if (!latest?.support || !latest.resistance) return null;
  const weakSide: LevelSide | null = latest.support.status !== 'strong' && latest.resistance.status === 'strong' ? 'support' : latest.resistance.status !== 'strong' && latest.support.status === 'strong' ? 'resistance' : null;
  if (!weakSide) return null; // both strong, or both weak: no confusion

  const of = (p: StrengthPoint) => (weakSide === 'support' ? p.support : p.resistance);
  // The current unbroken weak run, walking back from the latest snapshot.
  let first = pts.length - 1;
  while (first > 0 && of(pts[first - 1]) && of(pts[first - 1])!.status !== 'strong') first -= 1;
  const run = pts.slice(first);
  const start = run[0].ts;
  const minutes = (latest.ts - start) / 60;
  const pcts = run.map((p) => decisivePct(of(p)!)).filter((x): x is number => x !== null);
  const spread = pcts.length ? Math.max(...pcts) - Math.min(...pcts) : null;
  const strikes = run.map((p) => of(p)!.strike);
  const zone = { low: Math.min(...strikes), high: Math.max(...strikes) };
  const mine = events.filter((e) => e.side === weakSide && e.ts <= latest.ts);

  // 3 hours: the level shifted (after having been weak) and has been weak again for more than 180 minutes.
  const shiftedWhileWeak = mine.some((e) => e.ts >= start || pts.some((p) => p.ts < e.ts && of(p) && of(p)!.status !== 'strong'));
  const kind = (): SocResult['type'] | null => {
    if (shiftedWhileWeak && minutes > cfg.soc.threeHour.minutes) return '3h';
    const shiftInRun = mine.some((e) => e.ts >= start);
    if (shiftInRun || spread === null) return null;
    if (minutes > cfg.soc.oneHour.minutes && spread <= cfg.soc.oneHour.rangeMax) return '1h';
    if (minutes >= cfg.soc.twoHour.minutes && spread <= cfg.soc.twoHour.rangeMax) return '2h';
    return null;
  };
  const type = kind();
  if (!type) return null;
  const bearish = weakSide === 'support';
  return { type, side: weakSide, bias: bearish ? 'bearish' : 'bullish', from: bearish ? 'EOR' : 'EOS', startedAt: start, minutes, spread, targetStrike: bearish ? zone.low : zone.high, zone };
}
