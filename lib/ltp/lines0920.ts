// C9 the 9:20 lines: computed once at the first snapshot at or after 09:20:00 IST and frozen for the day. Entries, stops and targets for two
// risk profiles are displayed; nothing is executed. Every value is a proxy (see extensions.ts).
import { LTP_CONFIG, type LtpConfig } from './config';
import { extensionLevels, type ExtLevel, type ExtensionMethod } from './extensions';
import { computeLevels } from './levels';
import { statusOf } from './strength';
import { istDate, istTs } from './time';
import type { Snapshot } from './types';

export type Entry = { side: 'short' | 'long'; label: string; entry: number; stop: number | null; target: number | null; riskPoints: number | null };
export type Lines0920 = {
  date: string;
  snapshotTs: number; // the snapshot the lines were computed from
  delaySeconds: number; // how long after 09:20:00 that snapshot was taken
  method: string;
  eor: ExtLevel; eorPlus1: ExtLevel; eorPlus2: ExtLevel; eos: ExtLevel; eosMinus1: ExtLevel; eosMinus2: ExtLevel;
  bearishAllowed: boolean; // false when EOR or EOR+1 is unavailable
  bullishAllowed: boolean; // false when EOS or EOS-1 is unavailable
  profiles: { risky: Entry[]; moderate: Entry[] };
};

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
  const buffer = cfg.lines0920.stopBufferPoints;

  const bearishAllowed = e.eor.value !== null && eorPlus1.value !== null;
  const bullishAllowed = e.eos.value !== null && eosMinus1.value !== null;
  const short = (label: string, line: ExtLevel): Entry => {
    const stop = eorPlus2.value === null ? null : eorPlus2.value + buffer;
    return { side: 'short', label, entry: line.value!, stop, target: method.reversal(snap, line.strike, 'PE'), riskPoints: stop === null ? null : Math.abs(stop - line.value!) };
  };
  const long = (label: string, line: ExtLevel): Entry => {
    const stop = eosMinus2.value === null ? null : eosMinus2.value - buffer;
    return { side: 'long', label, entry: line.value!, stop, target: method.reversal(snap, line.strike, 'CE'), riskPoints: stop === null ? null : Math.abs(stop - line.value!) };
  };
  return {
    date, snapshotTs: snap.ts, delaySeconds: snap.ts - at, method: method.id,
    eor: e.eor, eorPlus1, eorPlus2, eos: e.eos, eosMinus1, eosMinus2, bearishAllowed, bullishAllowed,
    profiles: {
      risky: [...(bearishAllowed ? [short('EOR', e.eor)] : []), ...(bullishAllowed ? [long('EOS', e.eos)] : [])],
      moderate: [...(bearishAllowed ? [short('EOR+1', eorPlus1)] : []), ...(bullishAllowed ? [long('EOS-1', eosMinus1)] : [])],
    },
  };
}
