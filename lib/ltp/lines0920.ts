// C9 the 9:20 lines: computed once at the first snapshot at or after 09:20:00 IST and frozen for the day. Display only: nothing is executed.
// Laid out the way the real tool's header shows them (checked against its values on 2026-10-12):
//   short side (at resistance): Risky = EOR-1, Moderate = EOR, Max Pain = EOR+2, Max Gain = EOS
//   long side (at support):     Risky = EOS+1, Moderate = EOS, Max Pain = EOS-2, Max Gain = EOR
// Max Pain is where the idea fails, so it doubles as the stop. Every value is a proxy (see extensions.ts).
import { LTP_CONFIG, type LtpConfig } from './config';
import { extensionLevels, type ExtLevel, type ExtensionMethod } from './extensions';
import { computeLevels } from './levels';
import { statusOf } from './strength';
import { istDate, istTs } from './time';
import type { Snapshot } from './types';

export type TradeLines = {
  risky: ExtLevel; moderate: ExtLevel; maxPain: ExtLevel; maxGain: ExtLevel;
  riskPoints: { risky: number | null; moderate: number | null }; // distance from each entry to Max Pain; null when a value is missing
  available: boolean; // false when an entry or Max Pain value is missing (the side is then not shown)
};
export type Lines0920 = {
  date: string;
  snapshotTs: number; // the snapshot the lines were computed from
  delaySeconds: number; // how long after 09:20:00 that snapshot was taken
  method: string;
  eorMinus1: ExtLevel; eor: ExtLevel; eorPlus1: ExtLevel; eorPlus2: ExtLevel;
  eosPlus1: ExtLevel; eos: ExtLevel; eosMinus1: ExtLevel; eosMinus2: ExtLevel;
  short: TradeLines;
  long: TradeLines;
};

const distance = (entry: ExtLevel, stop: ExtLevel): number | null => (entry.value === null || stop.value === null ? null : Math.abs(stop.value - entry.value));
const trade = (risky: ExtLevel, moderate: ExtLevel, maxPain: ExtLevel, maxGain: ExtLevel): TradeLines => ({
  risky, moderate, maxPain, maxGain,
  riskPoints: { risky: distance(risky, maxPain), moderate: distance(moderate, maxPain) },
  available: risky.value !== null && moderate.value !== null && maxPain.value !== null,
});

export function freezeLines0920(snaps: Snapshot[], method: ExtensionMethod, cfg: LtpConfig = LTP_CONFIG): Lines0920 | null {
  const ordered = [...snaps].sort((a, b) => a.ts - b.ts);
  if (!ordered.length) return null;
  const date = istDate(ordered[0].ts);
  const at = istTs(date, cfg.lines0920.time);
  const snap = ordered.find((s) => s.ts >= at && istDate(s.ts) === date);
  if (!snap) return null;
  const levels = computeLevels(snap);
  if (!levels) return null;
  const e = extensionLevels(snap, levels, statusOf('support', levels.support, levels.line, cfg), statusOf('resistance', levels.resistance, levels.line, cfg), method);
  const [eorPlus1, eorPlus2] = e.eorPlus;
  const [eosMinus1, eosMinus2] = e.eosMinus;
  return {
    date, snapshotTs: snap.ts, delaySeconds: snap.ts - at, method: method.id,
    eorMinus1: e.eorMinus1, eor: e.eor, eorPlus1, eorPlus2, eosPlus1: e.eosPlus1, eos: e.eos, eosMinus1, eosMinus2,
    short: trade(e.eorMinus1, e.eor, eorPlus2, e.eos),
    long: trade(e.eosPlus1, e.eos, eosMinus2, e.eor),
  };
}
