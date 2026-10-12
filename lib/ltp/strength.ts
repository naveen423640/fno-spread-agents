// C3 Strong / WTT / WTB, the combination of volume and OI, level shifts and the old-strike rule. Pure.
import { LTP_CONFIG, type LtpConfig } from './config';
import { computeLevels, type Levels, type Line, type MetricPick, type SideLevel } from './levels';
import { valueAt, type LevelSide, type Metric, type Side, type Snapshot, type Status } from './types';

export type MetricStatus = {
  pct: number | null; // second-highest over highest, percent; null when there is no second value or the highest is not above zero
  weak: boolean; // pct above the threshold (exactly the threshold is still Strong) and not suppressed
  direction: 'wtt' | 'wtb' | null; // where the second-highest sits: above the level is WTT, below is WTB
  toward: boolean | null; // true when the second-highest sits between the level and the line (support: above; resistance: below)
  suppressed: boolean; // a weakness at an old, already-shifted-away-from strike is being ignored
};
export type SideStatus = { status: Status; byMetric: Record<Metric, MetricStatus> };

export function pctOf(pick: MetricPick | null): number | null {
  if (!pick || pick.secondValue === null || !(pick.value > 0)) return null;
  return (pick.secondValue / pick.value) * 100;
}

function metricStatus(side: LevelSide, pick: MetricPick | null, cfg: LtpConfig, ignoredStrike: number | null): MetricStatus {
  const pct = pctOf(pick);
  if (!pick || pct === null || pct <= cfg.weakThresholdPct || pick.secondStrike === null) return { pct, weak: false, direction: null, toward: null, suppressed: false };
  const direction = pick.secondStrike > pick.strike ? 'wtt' : 'wtb';
  const toward = side === 'support' ? direction === 'wtt' : direction === 'wtb';
  const suppressed = ignoredStrike !== null && pick.secondStrike === ignoredStrike;
  return { pct, weak: !suppressed, direction, toward, suppressed };
}

// Combines the two metrics for one side (course ch09).
// A level based on BOTH metrics (volume and OI peak at the same strike):
//   no metric weak                           -> Strong
//   exactly one weak, second-highest away    -> still Strong (away counts only when both metrics move away)
//   exactly one weak, second-highest toward  -> Weak, in that metric's direction (support WTT, resistance WTB)
//   both weak, same direction                -> that direction
//   both weak, opposite directions           -> the metric whose level is closer to the line decides; an exact tie goes to the one pointing toward the line
// A level based on ONE metric only (the peaks are at different strikes; the one closer to the line sets the level):
//   the deciding metric's own yellow box decides, in either direction (Strong, WTT or WTB);
//   the other metric matters only if its yellow box crosses the level on the line side of it: then support is WTT and resistance WTB.
export function statusOf(side: LevelSide, level: SideLevel, line: Line, cfg: LtpConfig = LTP_CONFIG, ignored: Record<Metric, number | null> = { volume: null, oi: null }): SideStatus {
  const byMetric: Record<Metric, MetricStatus> = { volume: metricStatus(side, level.byVolume, cfg, ignored.volume), oi: metricStatus(side, level.byOi, cfg, ignored.oi) };
  const strong: SideStatus = { status: 'strong', byMetric };
  if (level.decidedBy !== 'volume+oi') {
    const deciding: Metric = level.decidedBy;
    const other: Metric = deciding === 'volume' ? 'oi' : 'volume';
    if (byMetric[deciding].weak) return { status: byMetric[deciding].direction!, byMetric };
    const otherPick = other === 'volume' ? level.byVolume : level.byOi;
    const crosses = byMetric[other].weak && otherPick?.secondStrike != null && (side === 'support' ? otherPick.secondStrike > level.strike : otherPick.secondStrike < level.strike);
    return crosses ? { status: side === 'support' ? 'wtt' : 'wtb', byMetric } : strong;
  }
  const weak = (['volume', 'oi'] as Metric[]).filter((m) => byMetric[m].weak);
  if (!weak.length) return strong;
  if (weak.length === 1) return byMetric[weak[0]].toward ? { status: byMetric[weak[0]].direction!, byMetric } : strong;
  if (byMetric.volume.direction === byMetric.oi.direction) return { status: byMetric.volume.direction!, byMetric };
  const from = (m: Metric) => Math.abs((m === 'volume' ? level.byVolume! : level.byOi!).strike - (side === 'support' ? line.low : line.high));
  const winner = from('volume') < from('oi') ? 'volume' : from('oi') < from('volume') ? 'oi' : byMetric.volume.toward ? 'volume' : 'oi';
  return { status: byMetric[winner].direction!, byMetric };
}

export type LevelShift = { ts: number; side: LevelSide; metric: Metric; fromStrike: number; toStrike: number; cause: 'second-became-highest' | 'other' };
export type SideStrength = { strike: number; status: Status; pct: Record<Metric, number | null>; byMetric: Record<Metric, MetricStatus> };
export type StrengthPoint = { ts: number; levels: Levels | null; support: SideStrength | null; resistance: SideStrength | null };

const SIDES: [LevelSide, Side][] = [['support', 'PE'], ['resistance', 'CE']];
const METRICS: Metric[] = ['volume', 'oi'];

// Runs the strength logic over a time-ordered list of snapshots (sorted by ts here). Remembers each side and metric's highest strike so a change
// can be reported as a shift, and the strike it left so a weakness at that old strike is ignored until it has disappeared and then reappeared.
export function trackStrength(snaps: Snapshot[], cfg: LtpConfig = LTP_CONFIG): { perSnapshot: StrengthPoint[]; events: LevelShift[] } {
  const ordered = [...snaps].sort((a, b) => a.ts - b.ts);
  const prev: Record<string, { strike: number; second: number | null } | undefined> = {};
  const ignored: Record<string, number | null> = {};
  const events: LevelShift[] = [];
  const perSnapshot: StrengthPoint[] = [];

  for (const s of ordered) {
    const levels = computeLevels(s);
    if (!levels) { perSnapshot.push({ ts: s.ts, levels: null, support: null, resistance: null }); continue; }
    const point: StrengthPoint = { ts: s.ts, levels, support: null, resistance: null };
    for (const [side, optionSide] of SIDES) {
      const level = side === 'support' ? levels.support : levels.resistance;
      const ignoredNow: Record<Metric, number | null> = { volume: null, oi: null };
      for (const metric of METRICS) {
        const pick = metric === 'volume' ? level.byVolume : level.byOi;
        const key = `${side}:${metric}`;
        if (!pick) { ignored[key] = null; prev[key] = undefined; continue; }
        const before = prev[key];
        let shifted = false;
        if (before && before.strike !== pick.strike) {
          const cause = before.second === pick.strike ? 'second-became-highest' : 'other';
          events.push({ ts: s.ts, side, metric, fromStrike: before.strike, toStrike: pick.strike, cause });
          if (cause === 'second-became-highest') { ignored[key] = before.strike; shifted = true; }
          else ignored[key] = null;
        }
        // The old strike counts again once it has disappeared (at or below the threshold, or gone) and then reappeared.
        const old = ignored[key] ?? null;
        if (old !== null && !shifted) {
          const oldValue = valueAt(s, old, optionSide, metric);
          if (oldValue === null || !(pick.value > 0) || (oldValue / pick.value) * 100 <= cfg.weakThresholdPct) ignored[key] = null;
        }
        ignoredNow[metric] = ignored[key] ?? null;
        prev[key] = { strike: pick.strike, second: pick.secondStrike };
      }
      const st = statusOf(side, level, levels.line, cfg, ignoredNow);
      const strength: SideStrength = { strike: level.strike, status: st.status, pct: { volume: st.byMetric.volume.pct, oi: st.byMetric.oi.pct }, byMetric: st.byMetric };
      if (side === 'support') point.support = strength; else point.resistance = strength;
    }
    perSnapshot.push(point);
  }
  return { perSnapshot, events };
}
